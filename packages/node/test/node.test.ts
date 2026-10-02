import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DecisionRecord } from '@realhuman/engine';
import { parseDecisionRecord } from '@realhuman/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeHandler, createWebHandler } from '../src/index.js';

const SECRET = Buffer.alloc(32, 5).toString('base64');
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';
const silent = { debug() {}, info() {}, warn() {}, error() {} };

function payload(sid: string, nonce: string) {
  return {
    v: 1,
    sid,
    nonce,
    seq: 0,
    final: false,
    elapsedMs: 1000,
    wallElapsedMs: 1000,
    nonceAgeMs: 100,
    context: { visitor: 'abc' },
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
        timezone: 'UTC',
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
        domContentLoadedMs: 100,
      },
      honeypot: null,
    },
  };
}

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe('createNodeHandler', () => {
  it('serves init and score over node:http with a proxy-supplied JA4', async () => {
    const records: DecisionRecord[] = [];
    const handler = createNodeHandler({
      env: () => SECRET,
      logger: silent,
      ja4Header: 'x-ja4',
      deliver: 'both',
      onDecision: (r) => void records.push(r),
    });
    server = createServer((req, res) => {
      // Simulate mounting at /api/realhuman.
      req.url = req.url?.replace(/^\/api\/realhuman/, '') || '/';
      handler(req, res);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/realhuman`;
    const headers = {
      'user-agent': UA,
      'x-ja4': 't13d1717h2_5b57614c22b0_3cbfd9057e0d',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
    };

    const init = await (await fetch(`${base}/init`, { headers })).json();
    const response = await fetch(`${base}/score`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(payload(init.sid, init.nonce)),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sid: init.sid, seq: 0 });
    expect(response.headers.get('cache-control')).toBe('no-store');

    await handler.drain();
    expect(records).toHaveLength(1);
    expect(parseDecisionRecord(records[0]).success).toBe(true);
    expect(records[0]).toMatchObject({
      context: { visitor: 'abc' },
      server: { ja4: 't13d1717h2_5b57614c22b0_3cbfd9057e0d', uaFamily: 'firefox' },
    });
  });

  it('ignores JA4 headers unless ja4Header is configured', async () => {
    const records: DecisionRecord[] = [];
    const handler = createWebHandler({
      env: () => SECRET,
      logger: silent,
      onDecision: (r) => void records.push(r),
    });
    const headers = { 'user-agent': UA, 'x-ja4': 't13d1717h2_5b57614c22b0_3cbfd9057e0d' };
    const init = await (
      await handler(new Request('http://localhost/api/realhuman/init', { headers }))
    ).json();
    const response = await handler(
      new Request('http://localhost/api/realhuman/score', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload(init.sid, init.nonce)),
      }),
    );
    expect(response.status).toBe(204);
    await handler.drain();
    expect(records[0]?.server.ja4).toBeNull();
  });
});
