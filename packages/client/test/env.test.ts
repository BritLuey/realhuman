import { parsePayload } from '@realhuman/schema';
import { describe, expect, it } from 'vitest';
import {
  automationMarkers,
  clientHintsMismatch,
  featureMismatch,
  headlessMarkers,
  isSoftwareRenderer,
  NEUTRAL_ENV,
  nativeTamper,
  parseUa,
  probeEnvironment,
  timerGranularity,
} from '../src/signals/env.js';
import { scope } from '../src/util.js';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const HEADLESS = CHROME.replace('Chrome/', 'HeadlessChrome/');
const ANDROID =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';
const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const OLD_SAFARI = SAFARI.replace('Version/17.4', 'Version/15.3');

const brands = (major: string) => [
  { brand: 'Chromium', version: major },
  { brand: 'Not?A_Brand', version: '8' },
  { brand: 'Google Chrome', version: major },
];

describe('parseUa', () => {
  it('reads the claimed browser, version and platform', () => {
    expect(parseUa(CHROME)).toMatchObject({
      chromium: 141,
      firefox: 0,
      safari: 0,
      platform: 'Windows',
      mobile: false,
    });
    expect(parseUa(ANDROID)).toMatchObject({ chromium: 141, mobile: true, platform: 'Android' });
    expect(parseUa(FIREFOX)).toMatchObject({ chromium: 0, firefox: 143 });
    expect(parseUa(SAFARI)).toMatchObject({ safari: 1704, platform: 'macOS' });
  });
});

describe('automationMarkers', () => {
  it('finds framework leftovers and never reports cdp', () => {
    expect(automationMarkers(['document', 'location'], [], ['lang'])).toEqual([]);
    expect(
      automationMarkers(
        ['__playwright__binding__', '__pwInitScripts', '__puppeteer_evaluation_script__'],
        [],
        [],
      ),
    ).toEqual(['playwright', 'puppeteer']);
    expect(automationMarkers(['cdc_adoQpoasnfa76pfcZLmcfl_Array'], [], [])).toEqual(['selenium']);
    expect(automationMarkers([], ['$cdc_asdjflasutopfhvcZLmcfl_'], [])).toEqual(['selenium']);
    expect(automationMarkers(['_Selenium_IDE_Recorder', 'callSelenium'], [], [])).toEqual([
      'selenium',
    ]);
    expect(automationMarkers([], [], ['webdriver'])).toEqual(['selenium']);
    expect(automationMarkers(['__wdioSpy'], [], [])).toEqual(['webdriverio']);
    expect(automationMarkers(['callPhantom', '__nightmare'], [], [])).toEqual([
      'phantomjs',
      'nightmare',
    ]);
  });
});

describe('headlessMarkers', () => {
  const real = {
    ua: CHROME,
    outerWidth: 1280,
    outerHeight: 800,
    innerWidth: 1280,
    innerHeight: 690,
    screenWidth: 1920,
    screenHeight: 1080,
    fullscreen: false,
    windowChrome: true,
    plugins: 5,
    pdfViewer: true,
  };

  it('finds nothing in a normal browser', () => {
    expect(headlessMarkers(real)).toEqual([]);
  });

  it('labels headless traits', () => {
    expect(
      headlessMarkers({
        ...real,
        ua: HEADLESS,
        outerWidth: 0,
        outerHeight: 0,
        windowChrome: false,
        plugins: 0,
      }),
    ).toEqual(['ua_headless', 'zero_outer_size', 'missing_window_chrome', 'no_plugins']);
  });

  it('flags a desktop window with no browser UI, unless it is fullscreen', () => {
    const bare = {
      ...real,
      ua: CHROME,
      outerWidth: 1280,
      outerHeight: 720,
      innerWidth: 1280,
      innerHeight: 720,
    };
    expect(headlessMarkers(bare)).toEqual(['no_browser_ui']);
    expect(headlessMarkers({ ...bare, fullscreen: true })).toEqual([]);
    expect(headlessMarkers({ ...bare, ua: ANDROID, windowChrome: false })).toEqual([]);
  });

  it('flags a page exactly the size of the screen (headless default window), unless fullscreen', () => {
    // What headless Chrome reports: a 1280×720 "screen" that the page fills completely.
    const headless = {
      ...real,
      outerWidth: 1280,
      outerHeight: 720,
      innerWidth: 1280,
      innerHeight: 720,
      screenWidth: 1280,
      screenHeight: 720,
    };
    expect(headlessMarkers(headless)).toEqual(['no_browser_ui', 'viewport_is_screen']);
    expect(headlessMarkers({ ...headless, fullscreen: true })).toEqual([]);
    expect(headlessMarkers({ ...headless, ua: ANDROID, windowChrome: false })).toEqual([]);
    // A maximised real window: the page is smaller than the screen.
    expect(headlessMarkers({ ...real, innerWidth: 1920, innerHeight: 960 })).toEqual([]);
  });

  it('does not flag empty plugins when the PDF viewer is disabled, or on mobile', () => {
    expect(headlessMarkers({ ...real, plugins: 0, pdfViewer: false })).toEqual([]);
    expect(headlessMarkers({ ...real, ua: ANDROID, plugins: 0, windowChrome: false })).toEqual([]);
  });
});

describe('clientHintsMismatch', () => {
  it('agrees with a consistent Chromium', () => {
    expect(clientHintsMismatch(CHROME, { brands: brands('141'), platform: 'Windows' }, true)).toBe(
      false,
    );
  });

  it('catches a version or platform that disagrees', () => {
    expect(clientHintsMismatch(CHROME, { brands: brands('120'), platform: 'Windows' }, true)).toBe(
      true,
    );
    expect(clientHintsMismatch(CHROME, { brands: brands('141'), platform: 'Linux' }, true)).toBe(
      true,
    );
  });

  it('allows Android in desktop-site mode', () => {
    const desktopMode = CHROME.replace('Windows NT 10.0; Win64; x64', 'X11; Linux x86_64');
    expect(
      clientHintsMismatch(desktopMode, { brands: brands('141'), platform: 'Android' }, true),
    ).toBe(false);
  });

  it('catches Client Hints on a browser that claims to be Firefox or Safari', () => {
    expect(clientHintsMismatch(FIREFOX, { brands: brands('141'), platform: 'Windows' }, true)).toBe(
      true,
    );
    expect(clientHintsMismatch(SAFARI, { brands: [], platform: 'macOS' }, true)).toBe(true);
  });

  it('catches modern Chromium without Client Hints in a secure context', () => {
    expect(clientHintsMismatch(CHROME, undefined, true)).toBe(true);
    expect(clientHintsMismatch(CHROME, undefined, false)).toBeNull();
    expect(clientHintsMismatch(FIREFOX, undefined, true)).toBeNull();
  });
});

describe('featureMismatch', () => {
  it('expects modern features from modern browsers', () => {
    expect(featureMismatch(CHROME, true)).toBe(false);
    expect(featureMismatch(CHROME, false)).toBe(true);
    expect(featureMismatch(FIREFOX, false)).toBe(true);
    expect(featureMismatch(SAFARI, false)).toBe(true);
    expect(featureMismatch(OLD_SAFARI, false)).toBe(false);
    expect(featureMismatch('curl/8.0', false)).toBeNull();
  });
});

describe('nativeTamper', () => {
  class FakeNavigator {
    get userAgent() {
      return 'x';
    }
  }

  // happy-dom's Navigator is written in JavaScript, so borrow a real native getter.
  const nativeGetter = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
  const nativeProto = Object.defineProperty({}, 'userAgent', { get: nativeGetter as () => number });

  it('is false for native getters', () => {
    expect(nativeTamper({}, nativeProto)).toBe(false);
  });

  it('catches own properties on navigator and patched getters', () => {
    expect(nativeTamper({ webdriver: false }, nativeProto)).toBe(true);
    expect(nativeTamper({}, FakeNavigator.prototype)).toBe(true);
  });

  it('catches a replaced Function.prototype.toString', () => {
    const original = Function.prototype.toString;
    // biome-ignore lint/suspicious/noExplicitAny: test patch
    (Function.prototype as any).toString = function patched() {
      return 'function () {}';
    };
    try {
      expect(nativeTamper({}, {})).toBe(true);
    } finally {
      Function.prototype.toString = original;
    }
  });
});

describe('isSoftwareRenderer', () => {
  it('matches software renderers only', () => {
    expect(
      isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)'),
    ).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('Microsoft Basic Render Driver')).toBe(true);
    expect(
      isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'),
    ).toBe(false);
    expect(isSoftwareRenderer('Apple M2')).toBe(false);
  });
});

describe('timerGranularity', () => {
  it('measures the clock step', () => {
    let fine = 0;
    const fineClock = () => {
      fine += 0.1;
      return fine;
    };
    expect(timerGranularity(fineClock)).toBeCloseTo(0.1);
    // A clamped clock: only every 100th call sees the next 16.67 ms step.
    let calls = 0;
    const coarseClock = () => Math.floor(++calls / 100) * 16.67;
    expect(timerGranularity(coarseClock)).toBeCloseTo(16.67);
  });
});

describe('probeEnvironment', () => {
  it('produces schema-valid environment signals', async () => {
    const s = scope(() => {});
    const env = probeEnvironment(s);
    await Promise.race([env.ready, new Promise((r) => setTimeout(r, 1500))]);
    const snapshot = env.snapshot();
    s.stop();
    expect(snapshot.automationMarkers).not.toContain('cdp');
    expect(Object.keys(snapshot).sort()).toEqual(Object.keys(NEUTRAL_ENV).sort());
  });
});

describe('payload validity', () => {
  it('NEUTRAL_ENV is accepted by the schema', () => {
    const parsed = parsePayload({
      v: 1,
      sid: 'k3J9x0aQ2mW8pL5rT7yB',
      seq: 0,
      final: false,
      nonce: 'n'.repeat(20),
      elapsedMs: 1,
      wallElapsedMs: 1,
      nonceAgeMs: 1,
      context: {},
      signals: {
        env: NEUTRAL_ENV,
        pointer: null,
        keyboard: null,
        touch: null,
        scroll: null,
        timing: {
          firstInteractionMs: null,
          rafJitterMs: 0,
          eventLoopLagMs: 0,
          clockDriftMs: 0,
          visibilityChanges: 0,
          focusChanges: 0,
          domContentLoadedMs: null,
        },
        honeypot: null,
      },
    });
    expect(parsed.success).toBe(true);
  });
});
