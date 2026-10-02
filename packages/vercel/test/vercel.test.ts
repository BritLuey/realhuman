import type { DecisionRecord } from '@realhuman/engine';
import { parseDecisionRecord } from '@realhuman/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHandlers, type EdgeTag, tagRequests } from '../src/index.js';

const SECRET = Buffer.alloc(32, 3).toString('base64');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const JA4 = 't13d1516h2_8daaf6152771_02713d6af862';
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const CONTEXT = Symbol.for('@vercel/request-context');

function headers(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'user-agent': UA,
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'x-vercel-ja4-digest': JA4,
    'x-vercel-ip-timezone': 'America/New_York',
    ...extra,
  });
}

function payload(sid: string, nonce: string) {
  return {
    v: 1,
    sid,
    nonce,
    seq: 0,
    final: false,
    elapsedMs: 1000,
    wallElapsedMs: 1000,
    nonceAgeMs: 500,
    context: {},
    signals: {
      env: {
        webdriver: false,
        automationMarkers: [],
        headlessMarkers: [],
        softwareRenderer: false,
        uaClientHintsMismatch: null,
        workerMismatch: false,
        featureMismatch: false,
        nativeTamper: false,
        privacyBrowser: null,
        timezone: 'America/New_York',
        maxTouchPoints: 0,
      },
      pointer: null,
      keyboard: null,
      touch: null,
      scroll: null,
      timing: {
        firstInteractionMs: null,
        rafJitterMs: 1,
        eventLoopLagMs: 1,
        clockDriftMs: 0,
        visibilityChanges: 0,
        focusChanges: 0,
        domContentLoadedMs: null,
      },
      honeypot: null,
    },
  };
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CONTEXT];
});

describe('createHandlers', () => {
  it('reads JA4 and IP time zone from Vercel headers', async () => {
    const records: DecisionRecord[] = [];
    const { GET, POST } = createHandlers({
      env: () => SECRET,
      logger: silent,
      onDecision: (r) => void records.push(r),
    });
    const init = await (
      await GET(new Request('https://shop.example/api/realhuman/init', { headers: headers() }))
    ).json();
    const response = await POST(
      new Request('https://shop.example/api/realhuman/score', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload(init.sid, init.nonce)),
      }),
    );
    expect(response.status).toBe(204);
    expect(records).toHaveLength(1);
    expect(parseDecisionRecord(records[0]).success).toBe(true);
    expect(records[0]?.server).toMatchObject({
      ja4: JA4,
      timezoneMatch: true,
      uaFamily: 'chrome',
      platform: 'macos',
    });
  });

  it('hands background work to Vercel waitUntil inside a request context', async () => {
    const waitUntil = vi.fn();
    (globalThis as Record<symbol, unknown>)[CONTEXT] = { get: () => ({ waitUntil }) };
    const onDecision = vi.fn();
    const { GET, POST } = createHandlers({ env: () => SECRET, logger: silent, onDecision });
    const init = await (
      await GET(new Request('https://shop.example/api/realhuman/init', { headers: headers() }))
    ).json();
    await POST(
      new Request('https://shop.example/api/realhuman/score', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload(init.sid, init.nonce)),
      }),
    );
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]?.[0];
    expect(onDecision).toHaveBeenCalledTimes(1);
  });
});

describe('tagRequests', () => {
  it('labels requests, forwards a summary header and never blocks', async () => {
    const tags: EdgeTag[] = [];
    const tagger = tagRequests({ onTag: (t) => void tags.push(t), logger: silent });
    const response = await tagger(
      new Request('https://shop.example/products', { headers: headers() }),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-request-x-realhuman-edge')).toMatch(
      /^realHuman=[\d.]+; verdict=/,
    );
    expect(tags[0]).toMatchObject({ path: '/products', kind: 'no_js', server: { ja4: JA4 } });

    const curl = await tagger(
      new Request('https://shop.example/', { headers: { 'user-agent': 'curl/8.7.1' } }),
    );
    expect(curl.headers.get('x-middleware-request-x-realhuman-edge')).toContain('verdict=bot');
  });

  it('can skip forwarding and sample', async () => {
    const onTag = vi.fn();
    const tagger = tagRequests({ onTag, forwardHeader: false, sampleRate: 0, logger: silent });
    const response = await tagger(new Request('https://shop.example/', { headers: headers() }));
    expect(response.headers.get('x-middleware-override-headers')).toBeNull();
    expect(onTag).not.toHaveBeenCalled();
  });

  it('survives a failing onTag', async () => {
    const tagger = tagRequests({
      onTag: () => {
        throw new Error('nope');
      },
      logger: silent,
    });
    const response = await tagger(new Request('https://shop.example/', { headers: headers() }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
