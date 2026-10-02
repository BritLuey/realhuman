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

/** Screen and window-size getters: host pages never patch these, but bots faking their geometry do. */
const SCREEN_PROPS = ['width', 'height', 'availWidth', 'availHeight', 'colorDepth'];
const WINDOW_PROPS = [
  'outerWidth',
  'outerHeight',
  'innerWidth',
  'innerHeight',
  'screenX',
  'screenY',
];

/**
 * Whether a function is the browser's own. With `named` (Chromium, where the format is verified),
 * its source must also carry its name: Proxy wrappers used by stealth plugins print as
 * `function () { [native code] }` and are caught.
 */
export function isNativeFunction(fn: unknown, name: string, named: boolean): boolean {
  if (typeof fn !== 'function') return false;
  let text: string;
  try {
    text = Function.prototype.toString.call(fn);
  } catch {
    return false;
  }
  return NATIVE.test(text) && (!named || text.includes(name));
}

export interface TamperTarget {
  readonly owner: object | undefined;
  readonly names: readonly string[];
}

/** The getters checked by default: navigator, screen and window size. */
export function tamperTargets(): TamperTarget[] {
  return [
    { owner: Navigator.prototype, names: TAMPER_PROPS },
    { owner: typeof Screen === 'undefined' ? undefined : Screen.prototype, names: SCREEN_PROPS },
    { owner: window, names: WINDOW_PROPS },
  ];
}

/** Getters, or Function.prototype.toString itself, replaced by script (stealth plugins). */
export function nativeTamper(
  nav: object,
  targets: readonly TamperTarget[],
  named = false,
): boolean {
  if (!isNativeFunction(Function.prototype.toString, 'toString', named)) return true;
  if (Object.getOwnPropertyNames(nav).length > 0) return true;
  return targets.some(
    ({ owner, names }) =>
      owner !== undefined &&
      names.some((name) => {
        const getter = Object.getOwnPropertyDescriptor(owner, name)?.get;
        return getter !== undefined && !isNativeFunction(getter, name, named);
      }),
  );
}

export const isSoftwareRenderer = (renderer: string): boolean =>
  /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i.test(renderer);

/** The operating system a graphics stack belongs to, from the renderer string. null if unclear. */
export function graphicsPlatform(renderer: string): 'Windows' | 'Apple' | 'Linux' | null {
  if (/direct3d|\bd3d(9|11|12)\b/i.test(renderer)) return 'Windows';
  if (/\bmetal\b|apple (m\d|gpu)/i.test(renderer)) return 'Apple';
  if (/mesa|llvmpipe|softpipe|gallium/i.test(renderer)) return 'Linux';
  return null;
}

/**
 * Does the graphics stack belong to a different OS than the user agent claims? Linux graphics on
 * a browser claiming Windows is the classic server-hosted bot in disguise. null when unknown.
 */
export function rendererPlatformMismatch(
  renderer: string | null,
  platform: string,
): boolean | null {
  const graphics = renderer ? graphicsPlatform(renderer) : null;
  if (!graphics || !platform) return null;
  if (graphics === 'Windows') return platform !== 'Windows';
  // iOS user agents contain "like Mac OS X", so parseUa reports them as macOS too.
  if (graphics === 'Apple') return platform !== 'macOS';
  return platform === 'Windows' || platform === 'macOS';
}

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

/**
 * The WebGL renderer string, compared in the browser and never sent. Runs on the main thread and,
 * from its source text, inside the Worker (with OffscreenCanvas). Returns '' without WebGL.
 */
const readRenderer = (firefox: boolean): string => {
  try {
    const canvas =
      typeof document === 'undefined'
        ? new OffscreenCanvas(1, 1)
        : document.createElement('canvas');
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return '';
    // Firefox already returns the sanitised renderer from RENDERER and warns on the extension.
    const ext = firefox ? null : gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  } catch {
    return '';
  }
};

/** Runs on the main thread and, from its source text, inside the Worker. */
const navigatorFacts = () =>
  JSON.stringify([
    navigator.userAgent,
    navigator.hardwareConcurrency,
    (navigator.languages || []).join(),
    navigator.platform,
  ]);

interface WorkerFacts {
  /** Do navigator properties differ between page and Worker? null on error, CSP or timeout. */
  readonly mismatch: boolean | null;
  /** The Worker's WebGL renderer, '' if unavailable. */
  readonly renderer: string;
}

const NO_WORKER: WorkerFacts = { mismatch: null, renderer: '' };

/** Compares main-thread navigator facts with a Worker's, and reads the Worker's renderer. */
function workerFacts(s: Scope, firefox: boolean): Promise<WorkerFacts> {
  return new Promise((resolve) => {
    let worker: Worker | undefined;
    let url = '';
    const done = (value: WorkerFacts) => {
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      resolve(value);
    };
    try {
      const source = `postMessage([(${navigatorFacts})(), (${readRenderer})(${firefox})])`;
      url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = (e) =>
        done({ mismatch: e.data[0] !== navigatorFacts(), renderer: String(e.data[1] ?? '') });
      worker.onerror = () => done(NO_WORKER);
      s.wait(() => done(NO_WORKER), 1000);
      s.add(() => done(NO_WORKER));
    } catch {
      done(NO_WORKER);
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
  rendererPlatformMismatch: null,
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
  let renderer: string | null = null;
  let worker: boolean | null = null;
  let workerRenderer = '';
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
    settle(workerFacts(s, u.firefox > 0), (v) => {
      worker = v.mismatch;
      workerRenderer = v.renderer;
    }),
    new Promise<void>((resolve) =>
      s.idle(() => {
        try {
          renderer = readRenderer(u.firefox > 0) || null;
        } finally {
          resolve();
        }
      }),
    ),
  ]).then(() => {
    // A renderer string patched on the page (stealth plugins fake the GPU) doesn't reach Workers.
    if (renderer && workerRenderer && renderer !== workerRenderer) worker = true;
  });

  const tamper = nativeTamper(nav, tamperTargets(), u.chromium > 0);
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
        softwareRenderer: renderer === null ? null : isSoftwareRenderer(renderer),
        uaClientHintsMismatch: clientHints,
        workerMismatch: worker,
        featureMismatch: features,
        rendererPlatformMismatch: rendererPlatformMismatch(renderer, u.platform),
        nativeTamper: tamper,
        privacyBrowser: privacy,
        timezone: tz,
        maxTouchPoints: Math.min(64, Math.max(0, nav.maxTouchPoints | 0)),
      };
    },
  };
}
