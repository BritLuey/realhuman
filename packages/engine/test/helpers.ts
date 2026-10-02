import type { DecisionRecord, Payload, Signals } from '@realhuman/schema';
import { createRealHuman, type EngineOptions, type HandleContext } from '../src/index.js';

export const SECRET = Buffer.alloc(32, 7).toString('base64');
export const OTHER_SECRET = Buffer.alloc(32, 9).toString('base64');

export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
export const CHROME_JA4 = 't13d1516h2_8daaf6152771_02713d6af862';

export const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

export function browserHeaders(overrides: Record<string, string | null> = {}): Headers {
  const headers = new Headers({
    'user-agent': CHROME_UA,
    'sec-ch-ua': '"Chromium";v="141", "Not?A_Brand";v="8", "Google Chrome";v="141"',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'content-type': 'application/json',
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
  return headers;
}

export function humanSignals(): Signals {
  return {
    env: {
      webdriver: false,
      automationMarkers: [],
      headlessMarkers: [],
      softwareRenderer: false,
      uaClientHintsMismatch: false,
      workerMismatch: false,
      featureMismatch: false,
      nativeTamper: false,
      privacyBrowser: null,
      timezone: 'Europe/London',
      maxTouchPoints: 0,
    },
    pointer: {
      events: 84,
      trustedRatio: 1,
      coalescedPerMove: 2.4,
      speedMean: 0.61,
      speedCv: 0.83,
      accelerationCv: 1.9,
      curvatureMean: 0.22,
      straightRatio: 0.08,
      pauses: 3,
      clicks: 1,
      teleportClicks: 0,
      centerClicks: 0,
      pointerTypes: { mouse: 84, pen: 0, touch: 0 },
      pressureVariance: null,
    },
    keyboard: {
      events: 14,
      trustedRatio: 1,
      holdMeanMs: 92,
      holdCv: 0.31,
      gapMeanMs: 180,
      gapCv: 0.55,
      pastes: 0,
      keyClasses: { character: 12, editing: 2, navigation: 0, modifier: 0 },
    },
    touch: null,
    scroll: {
      events: 12,
      wheelEvents: 12,
      deltaModes: { pixel: 12, line: 0, page: 0 },
      quantizedRatio: 0.1,
      cadenceCv: 0.7,
    },
    timing: {
      firstInteractionMs: 340,
      rafJitterMs: 1.2,
      eventLoopLagMs: 3.5,
      clockDriftMs: 0.4,
      visibilityChanges: 0,
      focusChanges: 0,
      domContentLoadedMs: 210,
    },
    honeypot: {
      fields: 1,
      filled: 0,
      trapFollowed: false,
      canaryFollowed: false,
      fastSubmits: 0,
      syntheticClicks: 0,
    },
  };
}

export function botSignals(): Signals {
  const signals = humanSignals();
  return {
    ...signals,
    env: {
      ...signals.env,
      webdriver: true,
      headlessMarkers: ['zero_outer_size', 'no_plugins'],
      softwareRenderer: true,
    },
    pointer: {
      events: 30,
      trustedRatio: 0,
      coalescedPerMove: 0,
      speedMean: 1,
      speedCv: 0.01,
      accelerationCv: 0.01,
      curvatureMean: 0,
      straightRatio: 1,
      pauses: 0,
      clicks: 3,
      teleportClicks: 3,
      centerClicks: 3,
      pointerTypes: { mouse: 30, pen: 0, touch: 0 },
      pressureVariance: null,
    },
    keyboard: null,
    scroll: null,
  };
}

export function idleSignals(): Signals {
  const signals = humanSignals();
  return {
    ...signals,
    pointer: null,
    keyboard: null,
    scroll: null,
    timing: { ...signals.timing, firstInteractionMs: null },
  };
}

export interface Harness {
  readonly records: DecisionRecord[];
  readonly ctx: HandleContext;
  readonly engine: ReturnType<typeof createRealHuman>;
  init(
    headers?: Headers,
    query?: string,
  ): Promise<{ sid: string; nonce: string; expiresAt: number }>;
  score(
    payload: Partial<Payload> & { sid: string; nonce: string },
    headers?: Headers,
  ): Promise<Response>;
  clock: { now: number };
}

export function harness(
  options: EngineOptions = {},
  trusted = { ja4: CHROME_JA4, ipTimezone: 'Europe/London' },
): Harness {
  const records: DecisionRecord[] = [];
  const clock = { now: 1_790_000_000_000 };
  const engine = createRealHuman({
    env: (name) => (name === 'REALHUMAN_SECRET' ? SECRET : undefined),
    logger: silentLogger,
    now: () => clock.now,
    onDecision: (record) => {
      records.push(record);
    },
    ...options,
  });
  const ctx: HandleContext = { trusted };

  return {
    records,
    ctx,
    engine,
    clock,
    async init(headers = browserHeaders(), query = '') {
      const response = await engine.handle(
        new Request(`https://shop.example/api/realhuman/init${query}`, { headers }),
        ctx,
      );
      return response.json();
    },
    async score(payload, headers = browserHeaders()) {
      const body: Payload = {
        v: 1,
        seq: 0,
        final: false,
        elapsedMs: 1000,
        wallElapsedMs: 1000,
        nonceAgeMs: 900,
        context: {},
        signals: humanSignals(),
        ...payload,
      };
      return engine.handle(
        new Request('https://shop.example/api/realhuman/score', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }),
        ctx,
      );
    },
  };
}
