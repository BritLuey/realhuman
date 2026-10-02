import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseClientResult, parseDecisionRecord, parseInitResponse } from '@realhuman/schema';
import { describe, expect, it, vi } from 'vitest';
import { createRealHuman, rescore } from '../src/index.js';
import {
  botSignals,
  browserHeaders,
  CHROME_JA4,
  harness,
  humanSignals,
  SECRET,
  silentLogger,
} from './helpers.js';

describe('GET /init', () => {
  it('issues a session id and nonce', async () => {
    const h = harness();
    const body = await h.init();
    expect(parseInitResponse(body).success).toBe(true);
    expect(body.expiresAt).toBe(h.clock.now + 15 * 60_000);
  });

  it('keeps the session id when refreshing with a valid nonce', async () => {
    const h = harness();
    const first = await h.init();
    h.clock.now += 20 * 60_000; // past expiry, within the grace period
    const second = await h.init(browserHeaders(), `?refresh=${encodeURIComponent(first.nonce)}`);
    expect(second.sid).toBe(first.sid);
    expect(second.nonce).not.toBe(first.nonce);
  });

  it('starts a new session when the refresh nonce belongs to another client', async () => {
    const h = harness();
    const first = await h.init();
    const second = await h.init(
      browserHeaders({ 'user-agent': 'Mozilla/5.0 Firefox/133.0' }),
      `?refresh=${encodeURIComponent(first.nonce)}`,
    );
    expect(second.sid).not.toBe(first.sid);
  });

  it('sends no-store', async () => {
    const h = harness();
    const response = await h.engine.handle(
      new Request('https://shop.example/api/realhuman/init'),
      h.ctx,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('POST /score', () => {
  it('server mode: responds 204 and delivers a valid record', async () => {
    const h = harness();
    const { sid, nonce } = await h.init();
    const response = await h.score({ sid, nonce, context: { gaClientId: 'GA1.1.123' } });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(h.records).toHaveLength(1);
    const record = h.records[0];
    expect(parseDecisionRecord(record).success).toBe(true);
    expect(record).toMatchObject({
      sid,
      seq: 0,
      verdict: 'human',
      kind: 'human',
      engine: 'algorithmic',
      context: { gaClientId: 'GA1.1.123' },
      server: { ja4: CHROME_JA4, uaFamily: 'chrome', timezoneMatch: true },
    });
  });

  it('client mode: returns only the allowed fields and skips onDecision', async () => {
    const h = harness({ deliver: 'client', clientFields: ['realHuman'] });
    const { sid, nonce } = await h.init();
    const response = await h.score({ sid, nonce, seq: 2 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(parseClientResult(body).success).toBe(true);
    expect(Object.keys(body).sort()).toEqual(['realHuman', 'seq', 'sid', 'v']);
    expect(body.seq).toBe(2);
    expect(h.records).toHaveLength(0);
  });

  it('both mode: returns a result and delivers the record, never exposing reasons', async () => {
    const h = harness({
      deliver: 'both',
      clientFields: ['realHuman', 'verdict', 'kind', 'confidence'],
    });
    const { sid, nonce } = await h.init();
    const body = await (await h.score({ sid, nonce, signals: botSignals() })).json();
    expect(body.verdict).toBe('bot');
    expect(body).not.toHaveProperty('reasons');
    expect(h.records[0]?.reasons).toContain('webdriver');
  });

  it('uses waitUntil when the platform provides it', async () => {
    const h = harness();
    const pending: Promise<unknown>[] = [];
    const ctx = { ...h.ctx, waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    const { sid, nonce } = await h.init();
    const response = await h.engine.handle(
      new Request('https://shop.example/api/realhuman/score', {
        method: 'POST',
        headers: browserHeaders(),
        body: JSON.stringify({
          v: 1,
          sid,
          nonce,
          seq: 0,
          final: false,
          elapsedMs: 1000,
          wallElapsedMs: 1000,
          nonceAgeMs: 900,
          context: {},
          signals: humanSignals(),
        }),
      }),
      ctx,
    );
    expect(response.status).toBe(204);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(h.records).toHaveLength(1);
  });

  it('rejects malformed and oversized bodies', async () => {
    const h = harness({ maxPayloadBytes: 1000 });
    const bad = await h.engine.handle(
      new Request('https://shop.example/api/realhuman/score', { method: 'POST', body: '{"v":1}' }),
      h.ctx,
    );
    expect(bad.status).toBe(400);
    const notJson = await h.engine.handle(
      new Request('https://shop.example/api/realhuman/score', { method: 'POST', body: 'nope' }),
      h.ctx,
    );
    expect(notJson.status).toBe(400);
    const { sid, nonce } = await h.init();
    const big = await h.score({
      sid,
      nonce,
      context: { pad: 'x'.repeat(250) },
      signals: humanSignals(),
    });
    // The full payload is well over 1000 bytes.
    expect(big.status).toBe(413);
  });

  it('gates a nonce replayed from another client', async () => {
    const h = harness();
    const { sid, nonce } = await h.init();
    await h.score(
      { sid, nonce },
      browserHeaders({ 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0.0.0' }),
    );
    expect(h.records[0]).toMatchObject({ verdict: 'bot', engine: 'gate' });
    expect(h.records[0]?.reasons).toContain('nonce_replayed');
  });

  it('gates a forged or mismatched nonce', async () => {
    const h = harness();
    const { sid } = await h.init();
    await h.score({ sid, nonce: 'v1.forged-forged-forged.sig' });
    const other = await h.init();
    await h.score({ sid, nonce: other.nonce });
    expect(h.records.map((r) => r.reasons[0])).toEqual(['nonce_invalid', 'nonce_invalid']);
  });

  it('gates a fast-forwarded clock', async () => {
    const h = harness();
    const { sid, nonce } = await h.init();
    h.clock.now += 1000;
    await h.score({ sid, nonce, nonceAgeMs: 60_000 });
    expect(h.records[0]?.reasons).toContain('too_fast');
  });

  it('reports uncertain and records nothing when the secret is missing', async () => {
    const error = vi.fn();
    const h = harness({
      env: () => undefined,
      deliver: 'both',
      logger: { ...silentLogger, error },
    });
    const { sid, nonce } = await h.init();
    const body = await (await h.score({ sid, nonce })).json();
    expect(body).toMatchObject({ verdict: 'uncertain', realHuman: 0.5, confidence: 0 });
    expect(h.records).toHaveLength(0);
    expect(error).toHaveBeenCalledTimes(1); // logged once, not per request
  });

  it('survives a failing onDecision', async () => {
    const error = vi.fn();
    const h = harness({
      onDecision: () => {
        throw new Error('warehouse down');
      },
      logger: { ...silentLogger, error },
    });
    const { sid, nonce } = await h.init();
    expect((await h.score({ sid, nonce })).status).toBe(204);
    expect(error).toHaveBeenCalled();
  });
});

describe('serverContext', () => {
  it('adds trusted values from the server, overriding the browser on the same key', async () => {
    const h = harness({
      serverContext: (request) => ({
        userId: request.headers.get('x-test-user') ?? undefined,
        plan: 'pro',
      }),
    });
    const { sid, nonce } = await h.init();
    await h.score(
      { sid, nonce, context: { userId: 'forged-in-browser', gaClientId: 'GA1.1.1' } },
      browserHeaders({ 'x-test-user': 'user_42' }),
    );
    expect(h.records[0]?.context).toEqual({
      userId: 'user_42',
      plan: 'pro',
      gaClientId: 'GA1.1.1',
    });
  });

  it('drops the browser value for every key the server returns, even an empty one', async () => {
    const h = harness({ serverContext: () => ({ userId: null, plan: undefined }) });
    const { sid, nonce } = await h.init();
    await h.score({
      sid,
      nonce,
      context: { userId: 'forged-in-browser', plan: 'forged', gaClientId: 'GA1.1.1' },
    });
    expect(h.records[0]?.context).toEqual({ gaClientId: 'GA1.1.1' });
  });

  it('leaves keys the server does not return to the browser', async () => {
    const h = harness({ serverContext: () => ({}) });
    const { sid, nonce } = await h.init();
    await h.score({ sid, nonce, context: { userId: 'from-browser' } });
    expect(h.records[0]?.context).toEqual({ userId: 'from-browser' });
  });

  it('records no context if serverContext throws, so a forged value cannot slip through', async () => {
    const error = vi.fn();
    const h = harness({
      serverContext: () => {
        throw new Error('session store down');
      },
      logger: { ...silentLogger, error },
    });
    const { sid, nonce } = await h.init();
    await h.score({ sid, nonce, context: { userId: 'forged-in-browser', gaClientId: 'GA1.1.1' } });
    expect(h.records[0]?.context).toEqual({});
    expect(error).toHaveBeenCalled();
  });

  it('skips invalid entries and coerces numbers', async () => {
    const warn = vi.fn();
    const h = harness({
      serverContext: async () => ({
        'bad key': 'x',
        long: 'y'.repeat(300),
        accountId: 7 as never,
        empty: null,
      }),
      logger: { ...silentLogger, warn },
    });
    const { sid, nonce } = await h.init();
    await h.score({ sid, nonce });
    expect(h.records[0]?.context).toEqual({ accountId: '7' });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('is included on trap-link records', async () => {
    const h = harness({ serverContext: () => ({ userId: 'user_42' }) });
    const { sid, nonce } = await h.init();
    await h.engine.handle(
      new Request(`https://shop.example/api/realhuman/t?s=${sid}&n=${encodeURIComponent(nonce)}`),
      h.ctx,
    );
    expect(h.records[0]?.context).toEqual({ userId: 'user_42' });
  });
});

describe('trap link', () => {
  it('emits a decisive bot record that supersedes regular updates', async () => {
    const h = harness();
    const { sid, nonce } = await h.init();
    const response = await h.engine.handle(
      new Request(`https://shop.example/api/realhuman/t?s=${sid}&n=${encodeURIComponent(nonce)}`, {
        headers: { 'user-agent': 'SomeCrawler/1.0' },
      }),
      h.ctx,
    );
    expect(response.status).toBe(204);
    expect(h.records[0]).toMatchObject({
      sid,
      seq: 1000,
      verdict: 'bot',
      engine: 'gate',
      signals: null,
    });
    expect(h.records[0]?.reasons).toContain('honeypot_trap_followed');
    expect(h.records[0]?.reasons).not.toContain('no_js');
  });

  it('ignores trap hits without a genuine nonce', async () => {
    const h = harness();
    await h.engine.handle(
      new Request('https://shop.example/api/realhuman/t?s=abcdefghijklmnop&n=x'),
      h.ctx,
    );
    expect(h.records).toHaveLength(0);
  });
});

describe('routing and CORS', () => {
  it('returns 404 and 405', async () => {
    const h = harness();
    expect(
      (await h.engine.handle(new Request('https://shop.example/api/realhuman/other'), h.ctx))
        .status,
    ).toBe(404);
    expect(
      (await h.engine.handle(new Request('https://shop.example/api/realhuman/score'), h.ctx))
        .status,
    ).toBe(405);
  });

  it('only adds CORS headers for allowed origins', async () => {
    const h = harness({ allowedOrigins: ['https://www.shop.example'] });
    const allowed = await h.engine.handle(
      new Request('https://api.shop.example/api/realhuman/init', {
        headers: { origin: 'https://www.shop.example' },
      }),
      h.ctx,
    );
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://www.shop.example');
    const denied = await h.engine.handle(
      new Request('https://api.shop.example/api/realhuman/init', {
        headers: { origin: 'https://evil.example' },
      }),
      h.ctx,
    );
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('tag', () => {
  it('labels requests from network evidence alone', async () => {
    const engine = createRealHuman({
      env: () => SECRET,
      logger: silentLogger,
      onDecision: () => {},
    });
    const human = await engine.tag(
      new Request('https://shop.example/', { headers: browserHeaders() }),
      {
        ja4: CHROME_JA4,
        ipTimezone: null,
      },
    );
    expect(human).toMatchObject({ path: '/', kind: 'no_js', verdict: 'uncertain' });
    const curl = await engine.tag(
      new Request('https://shop.example/', { headers: { 'user-agent': 'curl/8.7.1' } }),
      {
        ja4: null,
        ipTimezone: null,
      },
    );
    expect(curl).toMatchObject({ verdict: 'bot', kind: 'scraper' });
    expect(curl.reasons).toContain('ua_bot');
  });
});

describe('rescore', () => {
  it('reproduces a decision from a stored record', async () => {
    const h = harness();
    const { sid, nonce } = await h.init();
    await h.score({ sid, nonce });
    const original = h.records[0];
    if (!original) throw new Error('no record');
    const again = await rescore(original);
    expect(again.realHuman).toBe(original.realHuman);
    expect(again.verdict).toBe(original.verdict);
    expect(again.sid).toBe(sid);
  });

  it('keeps request-only gates', async () => {
    const h = harness();
    const { sid, nonce } = await h.init();
    await h.score(
      { sid, nonce },
      browserHeaders({ 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0.0.0' }),
    );
    const replayed = h.records[0];
    if (!replayed) throw new Error('no record');
    expect((await rescore(replayed)).reasons).toContain('nonce_replayed');
  });

  const bin = fileURLToPath(new URL('../bin/realhuman-rescore.js', import.meta.url));
  const built = existsSync(fileURLToPath(new URL('../dist/index.js', import.meta.url)));

  it.skipIf(!built)('ships a working CLI', async () => {
    const h = harness();
    const { sid, nonce } = await h.init();
    await h.score({ sid, nonce });
    // A record from an older engine, before labels existed.
    const {
      label: _l,
      botEvidence: _b,
      humanEvidence: _h,
      primaryReason: _p,
      ...old
    } = h.records[0] ?? {};
    const input = `${JSON.stringify(old)}\nnot json\n`;
    const result = spawnSync(process.execPath, [bin], { input, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout.trim());
    expect(out).toMatchObject({
      label: 'human',
      humanEvidence: 'strong',
      primaryReason: 'pointer_natural',
    });
    expect(result.stderr).toContain('1 re-scored, 1 skipped');
  });
});
