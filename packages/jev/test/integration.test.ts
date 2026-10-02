import { createRealHuman, type DecisionRecord, type Payload, type Scorer } from '@realhuman/engine';
import { describe, expect, it } from 'vitest';
import { jev } from '../src/index.js';
import {
  browserHeaders,
  CHROME_JA4,
  GATEWAY_RESPONSE,
  hang,
  humanSignals,
  json,
  mockFetch,
  SECRET,
  silentLogger,
} from './helpers.js';

const ENV: Record<string, string> = { REALHUMAN_SECRET: SECRET, AI_GATEWAY_API_KEY: 'gw-test-key' };

/** Runs a real init → score round trip through the engine and returns the record and response. */
async function roundTrip(
  engine: Scorer,
  deliver: 'client' | 'both' = 'both',
  signals = humanSignals(),
) {
  const records: DecisionRecord[] = [];
  const clock = { now: 1_790_000_000_000 };
  const rh = createRealHuman({
    engine,
    deliver,
    env: (name) => ENV[name],
    logger: silentLogger,
    now: () => clock.now,
    onDecision: (record) => {
      records.push(record);
    },
  });
  const ctx = { trusted: { ja4: CHROME_JA4, ipTimezone: 'Europe/London' } };

  const init = await rh.handle(
    new Request('https://shop.example/api/realhuman/init', { headers: browserHeaders() }),
    ctx,
  );
  const { sid, nonce } = (await init.json()) as { sid: string; nonce: string };

  clock.now += 1000;
  const payload: Payload = {
    v: 1,
    sid,
    seq: 0,
    final: false,
    nonce,
    elapsedMs: 1003.4,
    wallElapsedMs: 1003,
    nonceAgeMs: 940,
    context: { gaClientId: '1234567890.1700000000' },
    signals,
  };
  const response = await rh.handle(
    new Request('https://shop.example/api/realhuman/score', {
      method: 'POST',
      headers: browserHeaders(),
      body: JSON.stringify(payload),
    }),
    ctx,
  );
  return { response, records, sid };
}

describe('createRealHuman with jev()', () => {
  it('scores a real session with Jev and records engine, model, provider and questionsVersion', async () => {
    const { fetch, calls } = mockFetch(json(GATEWAY_RESPONSE));
    const { response, records, sid } = await roundTrip(
      jev({ provider: 'vercel-ai-gateway', fetch }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      sid,
      seq: 0,
      realHuman: 0.931,
      verdict: 'human',
      confidence: 0.811,
    });

    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record).toMatchObject({
      sid,
      engine: 'jev',
      realHuman: 0.931,
      verdict: 'human',
      kind: 'human',
      model: 'typesafe-ai/jev',
      provider: 'vercel-ai-gateway',
      questionsVersion: '1',
    });
    expect(record?.reasons).toContain('jev_decision');

    // The request sent to the gateway carries no session id, join keys or time zone.
    expect(calls).toHaveLength(1);
    const sent = JSON.stringify(calls[0]?.body);
    expect(sent).not.toContain(sid);
    expect(sent).not.toContain('1234567890.1700000000');
    expect(sent).not.toContain('Europe/London');
  });

  it("works with deliver: 'client'", async () => {
    const { fetch } = mockFetch(json(GATEWAY_RESPONSE));
    const { response, records } = await roundTrip(
      jev({ provider: 'vercel-ai-gateway', fetch }),
      'client',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ realHuman: 0.931, verdict: 'human' });
    expect(records).toHaveLength(0);
  });

  it('falls back to the algorithmic engine when Jev hangs past timeoutMs', async () => {
    const { fetch, calls } = mockFetch(hang);
    const started = Date.now();
    const { response, records } = await roundTrip(
      jev({ provider: 'vercel-ai-gateway', timeoutMs: 50, fetch }),
    );

    expect(Date.now() - started).toBeLessThan(2000);
    expect(response.status).toBe(200);
    expect(calls[0]?.signal?.aborted).toBe(true);
    const [record] = records;
    expect(record?.engine).toBe('algorithmic-fallback');
    expect(record?.reasons).toContain('jev_unavailable');
    expect(record?.reasons).not.toContain('jev_decision');
    expect(record).not.toHaveProperty('provider');
  });

  it('falls back to the algorithmic engine when the provider errors', async () => {
    const { fetch } = mockFetch(
      json({ message: 'bad request', error_type: 'invalid_request' }, 400),
    );
    const { records } = await roundTrip(jev({ provider: 'vercel-ai-gateway', fetch }));
    expect(records[0]?.engine).toBe('algorithmic-fallback');
    expect(records[0]?.reasons).toContain('jev_unavailable');
  });

  it('never calls Jev for gated sessions', async () => {
    const { fetch, calls } = mockFetch(json(GATEWAY_RESPONSE));
    const signals = humanSignals();
    const gated = {
      ...signals,
      env: { ...signals.env, automationMarkers: ['playwright' as const] },
    };
    const { records } = await roundTrip(
      jev({ provider: 'vercel-ai-gateway', fetch }),
      'both',
      gated,
    );
    expect(calls).toHaveLength(0);
    expect(records[0]?.engine).toBe('gate');
  });
});
