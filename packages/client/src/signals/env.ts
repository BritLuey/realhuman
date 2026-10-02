// Environment checks. Every result is a boolean or a fixed label: the user agent, GPU name,
// languages and other identifying strings are compared in the browser and never sent.
import type {
  AutomationMarker,
  EnvironmentSignals,
  HeadlessMarker,
  PrivacyBrowser,
} from '@realhuman/schema';
import type { Scope } from '../util.js';

export interface UaInfo {
  /** Major version from `Chrome/NN` (every Chromium browser), else 0. */
  readonly chromium: number;
  readonly firefox: number;
  /** Safari version as major * 100 + minor (15.4 → 1504), else 0. */
  readonly safari: number;
  readonly mobile: boolean;
  readonly platform: string;
}

const version = (ua: string, pattern: RegExp): number => Number(pattern.exec(ua)?.[1] ?? 0);

export function parseUa(ua: string): UaInfo {
  const chromium = version(ua, /Chrome\/(\d+)/);
  const safari =
    !chromium &&
    !/Android|CriOS|FxiOS|EdgiOS/.test(ua) &&
    /Version\/(\d+)(?:\.(\d+))?.*Safari/.exec(ua);
  return {
    chromium,
    firefox: version(ua, /Firefox\/(\d+)/),
    safari: safari ? Number(safari[1]) * 100 + Number(safari[2] ?? 0) : 0,
    mobile: /Mobi|Android/.test(ua),
    platform: /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'Chrome OS'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '',
  };
}

// Selenium/ChromeDriver leftovers, e.g. cdc_…, _Selenium_IDE_Recorder, __webdriver_evaluate.
const SELENIUM =
  /^\$?cdc_|^\$wdc_|_selenium|callselenium|__(web|fx)?driver_(evaluate|unwrapped|script_fn)/i;
const MARKERS: [RegExp, AutomationMarker][] = [
  [/^__(pw|playwright)/, 'playwright'],
  [/^__puppeteer_evaluation_script__$/, 'puppeteer'],
  [/^__wdio/, 'webdriverio'],
  [/^(callPhantom|_phantom)$/, 'phantomjs'],
  [/^__nightmare$/, 'nightmare'],
  [SELENIUM, 'selenium'],
];

/** Labels automation frameworks from leftover globals. `cdp` is never emitted (DevTools users). */
export function automationMarkers(
  windowKeys: readonly string[],
  documentKeys: readonly string[],
  rootAttributes: readonly string[],
): AutomationMarker[] {
  const found = new Set<AutomationMarker>();
  for (const key of windowKeys) {
    for (const [pattern, label] of MARKERS) if (pattern.test(key)) found.add(label);
  }
  for (const key of documentKeys) if (SELENIUM.test(key)) found.add('selenium');
  for (const name of rootAttributes) {
    if (/^(webdriver|selenium|driver)$/.test(name)) found.add('selenium');
  }
  return [...found];
}

export interface HeadlessInput {
  readonly ua: string;
  readonly outerWidth: number;
  readonly outerHeight: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
  /** Browser fullscreen or kiosk mode, where there is legitimately no browser UI. */
  readonly fullscreen: boolean;
  readonly windowChrome: boolean;
  readonly plugins: number;
  /** `navigator.pdfViewerEnabled`; false means plugins are legitimately empty. */
  readonly pdfViewer: boolean;
}

export function headlessMarkers(input: HeadlessInput): HeadlessMarker[] {
  const u = parseUa(input.ua);
  const found: HeadlessMarker[] = [];
  if (/HeadlessChrome/.test(input.ua)) found.push('ua_headless');
  if (input.outerWidth === 0 && input.outerHeight === 0) found.push('zero_outer_size');
  // A desktop window always has tabs and an address bar above the page, unless it's fullscreen.
  else if (
    !u.mobile &&
    !input.fullscreen &&
    input.outerWidth === input.innerWidth &&
    input.outerHeight === input.innerHeight
  ) {
    found.push('no_browser_ui');
  }
  // Headless browsers make the screen exactly the size of the page. A real desktop page is smaller
  // than the screen (browser UI, taskbar, other windows), unless it's fullscreen.
  if (
    !u.mobile &&
    !input.fullscreen &&
    input.innerWidth > 0 &&
    input.innerWidth === input.screenWidth &&
    input.innerHeight === input.screenHeight
  ) {
    found.push('viewport_is_screen');
  }
  if (u.chromium && !u.mobile && !input.windowChrome) found.push('missing_window_chrome');
  // Desktop Chromium 94+ and Firefox 99+ always list the built-in PDF viewer.
  if (
    !u.mobile &&
    input.pdfViewer &&
    input.plugins === 0 &&
    (u.chromium >= 94 || u.firefox >= 99)
  ) {
    found.push('no_plugins');
  }
  return found;
}

interface UaData {
  readonly brands?: readonly { readonly brand: string; readonly version: string }[];
  readonly platform?: string;
}

const normalisePlatform = (p: string) => (p === 'Chromium OS' ? 'Chrome OS' : p);

/** Does `navigator.userAgentData` contradict the user-agent string? null when it can't tell. */
export function clientHintsMismatch(
  ua: string,
  data: UaData | undefined,
  secure: boolean,
): boolean | null {
  const u = parseUa(ua);
  if (!data) return u.chromium >= 90 && secure ? true : null;
  if (!u.chromium) return u.firefox || u.safari ? true : null;
  const chromium = data.brands?.find((b) => b.brand === 'Chromium');
  if (chromium && Number.parseInt(chromium.version, 10) !== u.chromium) return true;
  const platform = normalisePlatform(data.platform ?? '');
  // Android's "desktop site" mode reports a Linux user agent.
  if (
    platform &&
    u.platform &&
    platform !== u.platform &&
    !(platform === 'Android' && u.platform === 'Linux')
  ) {
    return true;
  }
  return false;
}

/** A browser claiming a recent version but missing features that version has. */
export function featureMismatch(ua: string, hasFeatures: boolean): boolean | null {
  const u = parseUa(ua);
  const recent = u.chromium
    ? u.chromium >= 98
    : u.firefox
      ? u.firefox >= 98
      : u.safari
        ? u.safari >= 1504
        : null;
  return recent === null ? null : recent && !hasFeatures;
}

const NATIVE = /\[native code\]/;
const TAMPER_PROPS = [
  'webdriver',
  'userAgent',
  'languages',
  'plugins',
  'platform',
  'hardwareConcurrency',
];

/** Navigator getters or Function.prototype.toString replaced by script (stealth plugins). */
export function nativeTamper(nav: object, proto: object): boolean {
  const source = Function.prototype.toString;
  const native = (fn: unknown) => typeof fn === 'function' && NATIVE.test(source.call(fn));
  if (!native(source) || Object.getOwnPropertyNames(nav).length > 0) return true;
  return TAMPER_PROPS.some((name) => {
    const getter = Object.getOwnPropertyDescriptor(proto, name)?.get;
    return getter !== undefined && !native(getter);
  });
}

export const isSoftwareRenderer = (renderer: string): boolean =>
  /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i.test(renderer);

/** Smallest step between distinct `performance.now()` values (a bounded busy loop). */
export function timerGranularity(clock: () => number = () => performance.now()): number {
  let last = clock();
  let step = Number.POSITIVE_INFINITY;
  for (let changes = 0, i = 0; changes < 5 && i < 1e6; i++) {
    const t = clock();
    if (t !== last) {
      step = Math.min(step, t - last);
      last = t;
      changes++;
    }
  }
  return step;
}

function softwareRenderer(firefox: boolean): boolean | null {
  const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
  if (!gl) return null;
  try {
    // Firefox already returns the sanitised renderer from RENDERER and warns on the extension.
    const ext = firefox ? null : gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    return isSoftwareRenderer(String(renderer ?? ''));
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Runs on the main thread and, from its source text, inside the Worker. */
const navigatorFacts = () =>
  JSON.stringify([
    navigator.userAgent,
    navigator.hardwareConcurrency,
    (navigator.languages || []).join(),
    navigator.platform,
  ]);

/** Compares main-thread navigator facts with a Worker's. null on error, CSP or 1 s timeout. */
function workerMismatch(s: Scope): Promise<boolean | null> {
  return new Promise((resolve) => {
    let worker: Worker | undefined;
    let url = '';
    const done = (value: boolean | null) => {
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      resolve(value);
    };
    try {
      const source = `postMessage((${navigatorFacts})())`;
      url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = (e) => done(e.data !== navigatorFacts());
      worker.onerror = () => done(null);
      s.wait(() => done(null), 1000);
      s.add(() => done(null));
    } catch {
      done(null);
    }
  });
}

export const NEUTRAL_ENV: EnvironmentSignals = {
  webdriver: false,
  automationMarkers: [],
  headlessMarkers: [],
  softwareRenderer: null,
  uaClientHintsMismatch: null,
  workerMismatch: null,
  featureMismatch: null,
  nativeTamper: false,
  privacyBrowser: null,
  timezone: null,
  maxTouchPoints: 0,
};

export interface EnvProbe {
  /** Settles when the asynchronous checks have finished. */
  readonly ready: Promise<unknown>;
  snapshot(): EnvironmentSignals;
}

type Nav = Navigator & {
  readonly userAgentData?: UaData;
  readonly brave?: { isBrave?: () => Promise<boolean> };
  readonly pdfViewerEnabled?: boolean;
};

function timezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 64) || null;
  } catch {
    return null;
  }
}

/** Starts the asynchronous checks; `snapshot()` adds the cheap synchronous ones at send time. */
export function probeEnvironment(s: Scope): EnvProbe {
  const nav = navigator as Nav;
  const ua = nav.userAgent;
  const u = parseUa(ua);
  const tz = timezone();
  let software: boolean | null = null;
  let worker: boolean | null = null;
  let permissions = false;
  let brave = false;
  const settle = <T>(p: Promise<T> | undefined, set: (v: T) => void) =>
    Promise.resolve(p)
      .then((v) => v !== undefined && set(v))
      .catch(() => {});

  const ready = Promise.all([
    settle(nav.brave?.isBrave?.(), (v) => {
      brave = v === true;
    }),
    typeof Notification !== 'undefined' && Notification.permission === 'denied'
      ? settle(nav.permissions?.query({ name: 'notifications' }), (st) => {
          permissions = st.state === 'prompt';
        })
      : 0,
    settle(workerMismatch(s), (v) => {
      worker = v;
    }),
    new Promise<void>((resolve) =>
      s.idle(() => {
        try {
          software = softwareRenderer(u.firefox > 0);
        } finally {
          resolve();
        }
      }),
    ),
  ]);

  const tamper = nativeTamper(nav, Navigator.prototype);
  const clientHints = clientHintsMismatch(ua, nav.userAgentData, window.isSecureContext);
  const features = featureMismatch(
    ua,
    typeof structuredClone === 'function' && typeof Array.prototype.at === 'function',
  );
  const rfp = u.firefox > 0 && tz === 'UTC' && timerGranularity() >= 16;

  return {
    ready,
    snapshot() {
      const headless = headlessMarkers({
        ua,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        screenWidth: screen.width,
        screenHeight: screen.height,
        fullscreen:
          !!document.fullscreenElement || matchMedia('(display-mode: fullscreen)').matches,
        windowChrome: 'chrome' in window,
        plugins: nav.plugins?.length ?? 0,
        pdfViewer: nav.pdfViewerEnabled !== false,
      });
      if (permissions) headless.push('permissions_inconsistent');
      const privacy: PrivacyBrowser | null = brave
        ? 'brave'
        : rfp
          ? innerWidth % 200 === 0 && innerHeight % 100 === 0
            ? 'tor'
            : 'firefox_rfp'
          : null;
      return {
        webdriver: nav.webdriver === true,
        automationMarkers: automationMarkers(
          Object.getOwnPropertyNames(window),
          Object.getOwnPropertyNames(document),
          document.documentElement.getAttributeNames(),
        ),
        headlessMarkers: headless,
        softwareRenderer: software,
        uaClientHintsMismatch: clientHints,
        workerMismatch: worker,
        featureMismatch: features,
        nativeTamper: tamper,
        privacyBrowser: privacy,
        timezone: tz,
        maxTouchPoints: Math.min(64, Math.max(0, nav.maxTouchPoints | 0)),
      };
    },
  };
}
