import { describe, expect, it, vi } from 'vitest';
import { type JevProvider, JevProviderError, jev } from '../src/index.js';
import {
  context,
  GATEWAY_RESPONSE,
  hang,
  humanAnalysis,
  json,
  mockFetch,
  TYPESAFE_RESPONSE,
} from './helpers.js';

const ENV = { AI_GATEWAY_API_KEY: 'gw', OPENROUTER_API_KEY: 'or', TYPESAFE_AI_API_KEY: 'ts' };

function withFailover(fetch: typeof globalThis.fetch) {
  return jev({
    provider: 'vercel-ai-gateway',
    failover: [{ provider: 'openrouter' }, { provider: 'typesafe', model: 'jev-1.13' }],
    fetch,
  });
}

describe('failover', () => {
  it.each([429, 402, 500, 503])('moves to the next provider on HTTP %i', async (status) => {
    const { fetch, calls } = mockFetch(
      json({ error: { message: 'busy', type: 'unavailable' } }, status),
      json(TYPESAFE_RESPONSE),
    );
    const result = await withFailover(fetch).score(humanAnalysis(), context(ENV));

    expect(calls.map((c) => c.url)).toEqual([
      'https://ai-gateway.vercel.sh/v1/evaluate',
      'https://openrouter.ai/api/v1/systemone',
    ]);
    expect(calls[1]?.headers.get('authorization')).toBe('Bearer or');
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('typesafe/jev-latest');
  });

  it('tries every provider in order and reports the one that answered', async () => {
    const { fetch, calls } = mockFetch(json({}, 429), json({}, 502), json(TYPESAFE_RESPONSE));
    const result = await withFailover(fetch).score(humanAnalysis(), context(ENV));

    expect(calls.map((c) => c.url)).toEqual([
      'https://ai-gateway.vercel.sh/v1/evaluate',
      'https://openrouter.ai/api/v1/systemone',
      'https://api.typesafe.ai/v1/systemone',
    ]);
    expect(calls[2]?.body.model).toBe('jev-1.13');
    expect(result.provider).toBe('typesafe');
    expect(result.model).toBe('jev-1.13');
  });

  it('moves on after a network error', async () => {
    const { fetch, calls } = mockFetch(new TypeError('fetch failed'), json(TYPESAFE_RESPONSE));
    const result = await withFailover(fetch).score(humanAnalysis(), context(ENV));
    expect(calls).toHaveLength(2);
    expect(result.provider).toBe('openrouter');
  });

  it('throws the last error when every provider is unavailable', async () => {
    const { fetch, calls } = mockFetch(json({}, 429), json({}, 500), json({}, 503));
    const error = (await withFailover(fetch)
      .score(humanAnalysis(), context(ENV))
      .catch((e: unknown) => e)) as JevProviderError;
    expect(calls).toHaveLength(3);
    expect(error).toBeInstanceOf(JevProviderError);
    expect(error.status).toBe(503);
  });

  it.each([400, 401, 403, 404, 422])('does not fail over on HTTP %i', async (status) => {
    const { fetch, calls } = mockFetch(
      json({ message: 'bad', error_type: 'invalid_request' }, status),
      json(TYPESAFE_RESPONSE),
    );
    const error = (await withFailover(fetch)
      .score(humanAnalysis(), context(ENV))
      .catch((e: unknown) => e)) as JevProviderError;
    expect(calls).toHaveLength(1);
    expect(error.status).toBe(status);
    expect(error.retryable).toBe(false);
  });

  it('does not fail over on a typed refusal, even with a 5xx status', async () => {
    const { fetch, calls } = mockFetch(
      json({ message: 'no', error_type: 'refusal' }, 500),
      json(TYPESAFE_RESPONSE),
    );
    await expect(withFailover(fetch).score(humanAnalysis(), context(ENV))).rejects.toThrow(
      /refusal/,
    );
    expect(calls).toHaveLength(1);
  });

  it('does not fail over on a malformed response', async () => {
    const { fetch, calls } = mockFetch(
      json({ answers: { human: { type: 'boolean' } } }),
      json(TYPESAFE_RESPONSE),
    );
    await expect(withFailover(fetch).score(humanAnalysis(), context(ENV))).rejects.toThrow(
      JevProviderError,
    );
    expect(calls).toHaveLength(1);
  });

  it('stops immediately when the overall signal aborts', async () => {
    const controller = new AbortController();
    const { fetch, calls } = mockFetch(hang, json(TYPESAFE_RESPONSE));
    const pending = withFailover(fetch).score(humanAnalysis(), context(ENV, controller.signal));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort(new Error('deadline'));

    await expect(pending).rejects.toThrow('deadline');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal).toBe(controller.signal);
  });

  it('does not start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('too late'));
    const { fetch, calls } = mockFetch(json(GATEWAY_RESPONSE));
    await expect(
      withFailover(fetch).score(humanAnalysis(), context(ENV, controller.signal)),
    ).rejects.toThrow('too late');
    expect(calls).toHaveLength(0);
  });

  it('treats a per-attempt abort (not the overall signal) as retryable', async () => {
    const flaky: JevProvider = {
      name: 'proxy',
      async evaluate() {
        throw new DOMException('attempt timed out', 'TimeoutError');
      },
    };
    const { fetch, calls } = mockFetch(json(GATEWAY_RESPONSE));
    const result = await jev({
      provider: flaky,
      failover: [{ provider: 'vercel-ai-gateway' }],
      fetch,
    }).score(humanAnalysis(), context(ENV));
    expect(calls).toHaveLength(1);
    expect(result.provider).toBe('vercel-ai-gateway');
  });

  it('a missing key on the main provider is not retried elsewhere', async () => {
    const { fetch, calls } = mockFetch(json(TYPESAFE_RESPONSE));
    await expect(
      withFailover(fetch).score(humanAnalysis(), context({ OPENROUTER_API_KEY: 'or' })),
    ).rejects.toThrow(/AI_GATEWAY_API_KEY/);
    expect(calls).toHaveLength(0);
  });
});

describe('custom providers', () => {
  it('receive the normalised request, the signal and env, and their name is recorded', async () => {
    const evaluate = vi.fn<JevProvider['evaluate']>(async () => ({
      human: { type: 'boolean', probability: 0.4 },
      kind: { type: 'choice', choice: 'ai_agent', probabilities: { ai_agent: 0.7, human: 0.3 } },
    }));
    const ctx = context({ PROXY_TOKEN: 'x' });
    const result = await jev({ provider: { name: 'my-proxy', evaluate }, model: 'jev-1.13' }).score(
      humanAnalysis(),
      ctx,
    );

    const [request, init] = evaluate.mock.calls[0] ?? [];
    expect(request?.model).toBe('jev-1.13');
    expect(request?.questions.human?.type).toBe('boolean');
    expect(init?.signal).toBe(ctx.signal);
    expect(init?.env('PROXY_TOKEN')).toBe('x');
    expect(result).toMatchObject({
      realHuman: 0.4,
      kind: 'ai_agent',
      confidence: 0.7,
      provider: 'my-proxy',
    });
  });

  it('a retryable JevProviderError from a custom provider fails over', async () => {
    const provider: JevProvider = {
      name: 'down',
      async evaluate() {
        throw new JevProviderError('down', { status: 503, retryable: true });
      },
    };
    const { fetch } = mockFetch(json(GATEWAY_RESPONSE));
    const result = await jev({
      provider,
      failover: [{ provider: 'vercel-ai-gateway' }],
      fetch,
    }).score(humanAnalysis(), context(ENV));
    expect(result.provider).toBe('vercel-ai-gateway');
  });

  it('other errors from a custom provider are not retried', async () => {
    const provider: JevProvider = {
      name: 'broken',
      async evaluate() {
        throw new Error('bug');
      },
    };
    const { fetch, calls } = mockFetch(json(GATEWAY_RESPONSE));
    await expect(
      jev({ provider, failover: [{ provider: 'vercel-ai-gateway' }], fetch }).score(
        humanAnalysis(),
        context(ENV),
      ),
    ).rejects.toThrow('bug');
    expect(calls).toHaveLength(0);
  });
});
