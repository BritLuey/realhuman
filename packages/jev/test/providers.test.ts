import { describe, expect, it } from 'vitest';
import { JevProviderError, jev, QUESTIONS, QUESTIONS_VERSION } from '../src/index.js';
import {
  context,
  GATEWAY_RESPONSE,
  humanAnalysis,
  json,
  mockFetch,
  TYPESAFE_RESPONSE,
} from './helpers.js';

describe('vercel-ai-gateway', () => {
  it('calls the native evaluate API with bearer auth, both questions and zero data retention', async () => {
    const { fetch, calls } = mockFetch(json(GATEWAY_RESPONSE));
    const ctx = context();
    await jev({ provider: 'vercel-ai-gateway', fetch }).score(humanAnalysis(), ctx);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://ai-gateway.vercel.sh/v1/evaluate');
    expect(call?.headers.get('authorization')).toBe('Bearer gw-test-key');
    expect(call?.headers.get('content-type')).toBe('application/json');
    expect(call?.signal).toBe(ctx.signal);
    expect(call?.body.model).toBe('typesafe-ai/jev');
    expect(call?.body.questions).toEqual(QUESTIONS);
    expect(call?.body.providerOptions).toEqual({ gateway: { zeroDataRetention: true } });
    expect(call?.body.state).toMatchObject({
      network: { uaFamily: 'chrome' },
      privacyBrowser: false,
    });
  });

  it('maps the answers to a scorer result', async () => {
    const { fetch } = mockFetch(json(GATEWAY_RESPONSE));
    const analysis = humanAnalysis();
    const result = await jev({ provider: 'vercel-ai-gateway', fetch }).score(analysis, context());

    expect(result).toEqual({
      realHuman: 0.931,
      confidence: 0.811,
      kind: 'human',
      reasons: [...analysis.evidence.map((e) => e.code), ...analysis.neutral, 'jev_decision'],
      model: 'typesafe-ai/jev',
      provider: 'vercel-ai-gateway',
      questionsVersion: QUESTIONS_VERSION,
    });
    expect(result.reasons).toContain('pointer_natural');
  });

  it('honours apiKeyEnv, model, baseUrl and zeroDataRetention: false', async () => {
    const { fetch, calls } = mockFetch(json(GATEWAY_RESPONSE));
    await jev({
      provider: 'vercel-ai-gateway',
      apiKeyEnv: 'MY_GATEWAY_KEY',
      model: 'typesafe-ai/jev-1.13',
      baseUrl: 'https://proxy.internal/gw/v1/',
      zeroDataRetention: false,
      fetch,
    }).score(humanAnalysis(), context({ MY_GATEWAY_KEY: 'custom' }));

    expect(calls[0]?.url).toBe('https://proxy.internal/gw/v1/evaluate');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer custom');
    expect(calls[0]?.body.model).toBe('typesafe-ai/jev-1.13');
    expect(calls[0]?.body).not.toHaveProperty('providerOptions');
  });

  it('falls back to the Vercel OIDC token when no gateway key is set', async () => {
    const { fetch, calls } = mockFetch(json(GATEWAY_RESPONSE));
    await jev({ provider: 'vercel-ai-gateway', fetch }).score(
      humanAnalysis(),
      context({ VERCEL_OIDC_TOKEN: 'oidc-token' }),
    );
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer oidc-token');
  });

  it('throws a non-retryable error without calling the API when no key is available', async () => {
    const { fetch, calls } = mockFetch(json(GATEWAY_RESPONSE));
    const error = await jev({ provider: 'vercel-ai-gateway', fetch })
      .score(humanAnalysis(), context({}))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevProviderError);
    expect((error as JevProviderError).retryable).toBe(false);
    expect((error as JevProviderError).message).toContain('AI_GATEWAY_API_KEY');
    expect(calls).toHaveLength(0);
  });
});

describe('typesafe', () => {
  it('calls /systemone with noul questions and maps noul answers back', async () => {
    const { fetch, calls } = mockFetch(json(TYPESAFE_RESPONSE));
    const result = await jev({ provider: 'typesafe', fetch }).score(
      humanAnalysis(),
      context({ TYPESAFE_AI_API_KEY: 'ts-key' }),
    );

    const [call] = calls;
    expect(call?.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(call?.headers.get('authorization')).toBe('Bearer ts-key');
    expect(call?.headers.get('content-type')).toBe('application/json');
    expect(call?.body.model).toBe('jev-latest');
    expect(call?.body).not.toHaveProperty('providerOptions');
    const questions = call?.body.questions as Record<string, { type: string }>;
    expect(questions.human).toEqual({ ...QUESTIONS.human, type: 'noul' });
    expect(questions.kind).toEqual(QUESTIONS.kind);

    expect(result.realHuman).toBe(0.12);
    expect(result.kind).toBe('automation');
    // No kind probabilities: confidence is |2p - 1|.
    expect(result.confidence).toBe(0.76);
    expect(result.provider).toBe('typesafe');
    expect(result.model).toBe('jev-latest');
  });

  it('missing key is a non-retryable error naming the variable', async () => {
    const { fetch } = mockFetch(json(TYPESAFE_RESPONSE));
    await expect(
      jev({ provider: 'typesafe', fetch }).score(humanAnalysis(), context({})),
    ).rejects.toThrow(/TYPESAFE_AI_API_KEY/);
  });
});

describe('openrouter', () => {
  it('uses the TypeSafe shape at the OpenRouter base URL', async () => {
    const { fetch, calls } = mockFetch(json(TYPESAFE_RESPONSE));
    await jev({ provider: 'openrouter', fetch }).score(
      humanAnalysis(),
      context({ OPENROUTER_API_KEY: 'or-key' }),
    );

    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/systemone');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer or-key');
    expect(calls[0]?.body.model).toBe('typesafe/jev-latest');
    const questions = calls[0]?.body.questions as Record<string, { type: string }> | undefined;
    expect(questions?.human?.type).toBe('noul');
  });

  it('allows baseUrl to be overridden', async () => {
    const { fetch, calls } = mockFetch(json(TYPESAFE_RESPONSE));
    await jev({ provider: 'openrouter', baseUrl: 'https://openrouter.example/v2', fetch }).score(
      humanAnalysis(),
      context({ OPENROUTER_API_KEY: 'or-key' }),
    );
    expect(calls[0]?.url).toBe('https://openrouter.example/v2/systemone');
  });
});

describe('answer mapping', () => {
  const answer = async (answers: unknown) => {
    const { fetch } = mockFetch(json({ answers }));
    return jev({ provider: 'vercel-ai-gateway', fetch }).score(humanAnalysis(), context());
  };

  it('falls back to human/unknown when the kind answer is missing or not an option', async () => {
    expect((await answer({ human: { type: 'boolean', probability: 0.8 } })).kind).toBe('human');
    expect((await answer({ human: { type: 'boolean', probability: 0.5 } })).kind).toBe('unknown');
    expect(
      (
        await answer({
          human: { type: 'boolean', probability: 0.2 },
          kind: { type: 'choice', choice: 'verified_agent' },
        })
      ).kind,
    ).toBe('unknown');
  });

  it('clamps probabilities and confidence to 0-1', async () => {
    const result = await answer({
      human: { type: 'boolean', probability: 1.0004 },
      kind: { type: 'choice', choice: 'human', probabilities: { human: 1.2 } },
    });
    expect(result.realHuman).toBe(1);
    expect(result.confidence).toBe(1);
  });

  it('deduplicates reasons', async () => {
    const result = await answer({ human: { type: 'boolean', probability: 0.9 } });
    expect(new Set(result.reasons).size).toBe(result.reasons.length);
    expect(result.reasons.at(-1)).toBe('jev_decision');
  });

  it.each([
    ['no answers', {}],
    ['answers not an object', { answers: 'yes' }],
    ['missing human answer', { answers: { kind: { type: 'choice', choice: 'human' } } }],
    ['human answer of the wrong type', { answers: { human: { type: 'choice', choice: 'yes' } } }],
    ['non-numeric probability', { answers: { human: { type: 'boolean', probability: 'high' } } }],
    ['NaN-like probability', { answers: { human: { type: 'boolean', probability: null } } }],
    [
      'invalid kind probabilities',
      {
        answers: {
          human: { type: 'boolean', probability: 0.5 },
          kind: { type: 'choice', choice: 'human', probabilities: { human: 'x' } },
        },
      },
    ],
    ['unsupported answer type', { answers: { human: { type: 'score', score: 1 } } }],
  ])('throws on a malformed response: %s', async (_name, body) => {
    const { fetch } = mockFetch(json(body));
    const error = await jev({ provider: 'vercel-ai-gateway', fetch })
      .score(humanAnalysis(), context())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevProviderError);
    expect((error as JevProviderError).retryable).toBe(false);
  });

  it('throws when the body is not JSON', async () => {
    const { fetch } = mockFetch(new Response('<html>oops</html>', { status: 200 }));
    await expect(
      jev({ provider: 'vercel-ai-gateway', fetch }).score(humanAnalysis(), context()),
    ).rejects.toThrow(JevProviderError);
  });

  it('includes the provider message, never the key, in HTTP errors', async () => {
    const { fetch } = mockFetch(
      json({ message: 'questions.kind: too many options', error_type: 'invalid_request' }, 400),
    );
    const error = (await jev({ provider: 'typesafe', fetch })
      .score(humanAnalysis(), context({ TYPESAFE_AI_API_KEY: 'secret-key-value' }))
      .catch((e: unknown) => e)) as JevProviderError;
    expect(error.status).toBe(400);
    expect(error.message).toContain('invalid_request');
    expect(error.message).toContain('too many options');
    expect(error.message).not.toContain('secret-key-value');
  });
});

describe('configuration', () => {
  it('exposes timeoutMs, defaulting to 800', () => {
    expect(jev({ provider: 'vercel-ai-gateway' }).timeoutMs).toBe(800);
    expect(jev({ provider: 'vercel-ai-gateway', timeoutMs: 1500 }).timeoutMs).toBe(1500);
    expect(jev({ provider: 'vercel-ai-gateway' }).name).toBe('jev');
  });

  it('rejects invalid options at construction', () => {
    expect(() => jev({ provider: 'nope' as 'typesafe' })).toThrow(TypeError);
    expect(() => jev({ provider: 'typesafe', timeoutMs: 0 })).toThrow(TypeError);
    expect(() => jev({ provider: 'typesafe', model: {} })).toThrow(TypeError);
    expect(() =>
      jev({ provider: 'typesafe', failover: [{ provider: 'ai-sdk' as 'typesafe' }] }),
    ).toThrow(TypeError);
  });
});
