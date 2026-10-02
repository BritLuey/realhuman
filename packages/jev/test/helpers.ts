import {
  type Analysis,
  analyze,
  deriveServerFacts,
  type ScorerContext,
  type Signals,
} from '@realhuman/engine';
import { vi } from 'vitest';

export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
export const CHROME_JA4 = 't13d1516h2_8daaf6152771_02713d6af862';
export const SECRET = Buffer.alloc(32, 7).toString('base64');

export const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

export function browserHeaders(): Headers {
  return new Headers({
    'user-agent': CHROME_UA,
    'sec-ch-ua': '"Chromium";v="141", "Not?A_Brand";v="8", "Google Chrome";v="141"',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'content-type': 'application/json',
  });
}

/** Same shape as `validSignals()` in packages/schema/test/fixtures.ts. */
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
    keyboard: null,
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

export function humanAnalysis(signals: Signals | null = humanSignals()): Analysis {
  const server = deriveServerFacts(
    browserHeaders(),
    { ja4: CHROME_JA4, ipTimezone: 'Europe/London' },
    signals?.env.timezone ?? null,
    null,
  );
  return analyze({ signals, server, ja4Lists: { browser: [], nonBrowser: [] } });
}

export function context(
  env: Record<string, string> = { AI_GATEWAY_API_KEY: 'gw-test-key' },
  signal: AbortSignal = new AbortController().signal,
): ScorerContext {
  return {
    signal,
    env: (name) => env[name],
    logger: silentLogger,
    thresholds: { human: 0.7, bot: 0.3 },
    debug: false,
  };
}

export const GATEWAY_RESPONSE = {
  model: 'typesafe-ai/jev',
  answers: {
    human: { type: 'boolean', probability: 0.93127 },
    kind: {
      type: 'choice',
      choice: 'human',
      probabilities: {
        human: 0.8114,
        privacy_browser: 0.1,
        automation: 0.04,
        scraper: 0.03,
        ai_agent: 0.0186,
      },
    },
  },
  usage: { inputTokens: 1480, outputTokens: 0 },
  providerMetadata: { gateway: {} },
};

export const TYPESAFE_RESPONSE = {
  model: 'jev-latest',
  answers: {
    human: { type: 'noul', noul: 0.12 },
    kind: { type: 'choice', choice: 'automation' },
  },
};

export interface Call {
  readonly url: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
  readonly signal: AbortSignal | null | undefined;
}

type Reply = Response | Error | ((call: Call) => Response | Promise<Response>);

/** A fetch mock that answers each call with the next reply (the last one repeats). Records calls. */
export function mockFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      signal: init?.signal,
    };
    const reply = replies[Math.min(calls.length, replies.length - 1)];
    calls.push(call);
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(call);
    if (!reply) throw new Error('no reply configured');
    return reply.clone();
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A reply that never resolves until the request's signal aborts. */
export function hang(call: Call): Promise<Response> {
  return new Promise((_, reject) => {
    const signal = call.signal;
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}
