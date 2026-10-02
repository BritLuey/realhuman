import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JevProviderError, jev, QUESTIONS } from '../src/index.js';
import { context, GATEWAY_RESPONSE, humanAnalysis, json, mockFetch } from './helpers.js';

const { evaluate } = vi.hoisted(() => ({ evaluate: vi.fn() }));
vi.mock('ai', () => ({ experimental_evaluate: evaluate }));

/** Looks like `gateway.evaluationModel('typesafe-ai/jev')`. */
const model = {
  specificationVersion: 'v4',
  provider: 'gateway',
  modelId: 'typesafe-ai/jev',
  supportedQuestionTypes: ['choice', 'score', 'boolean'],
  doEvaluate: vi.fn(),
};

/** Shaped like the AI SDK's APICallError. */
function apiCallError(statusCode: number) {
  return Object.assign(new Error(`HTTP ${statusCode}`), {
    name: 'AI_APICallError',
    statusCode,
    isRetryable: true,
  });
}

beforeEach(() => {
  evaluate.mockReset();
});

describe("provider: 'ai-sdk'", () => {
  it('calls experimental_evaluate with the model object, questions, signal and no SDK retries', async () => {
    evaluate.mockResolvedValue({ answers: GATEWAY_RESPONSE.answers, providerMetadata: {} });
    const ctx = context({});
    const result = await jev({ provider: 'ai-sdk', model }).score(humanAnalysis(), ctx);

    expect(evaluate).toHaveBeenCalledTimes(1);
    const options = evaluate.mock.calls[0]?.[0];
    expect(options.model).toBe(model);
    expect(options.questions).toEqual(QUESTIONS);
    expect(options.state).toMatchObject({ network: { uaFamily: 'chrome' } });
    expect(options.abortSignal).toBe(ctx.signal);
    expect(options.maxRetries).toBe(0);
    expect(options.providerOptions).toEqual({ gateway: { zeroDataRetention: true } });

    expect(result).toMatchObject({
      realHuman: 0.931,
      kind: 'human',
      provider: 'ai-sdk',
      model: 'typesafe-ai/jev',
    });
  });

  it('accepts a model id string and defaults to typesafe-ai/jev', async () => {
    evaluate.mockResolvedValue({ answers: GATEWAY_RESPONSE.answers });
    const explicit = await jev({ provider: 'ai-sdk', model: 'typesafe-ai/jev-1.13' }).score(
      humanAnalysis(),
      context(),
    );
    expect(evaluate.mock.calls[0]?.[0].model).toBe('typesafe-ai/jev-1.13');
    expect(explicit.model).toBe('typesafe-ai/jev-1.13');

    const fallback = await jev({ provider: 'ai-sdk' }).score(humanAnalysis(), context());
    expect(evaluate.mock.calls[1]?.[0].model).toBe('typesafe-ai/jev');
    expect(fallback.model).toBe('typesafe-ai/jev');
  });

  it('fails over to HTTP providers when the AI SDK reports a retryable status', async () => {
    evaluate.mockRejectedValue(apiCallError(429));
    const { fetch, calls } = mockFetch(json(GATEWAY_RESPONSE));
    const result = await jev({
      provider: 'ai-sdk',
      model,
      failover: [{ provider: 'vercel-ai-gateway' }],
      fetch,
    }).score(humanAnalysis(), context());
    expect(calls).toHaveLength(1);
    expect(result.provider).toBe('vercel-ai-gateway');
  });

  it('does not fail over on a 400 from the AI SDK', async () => {
    evaluate.mockRejectedValue(apiCallError(400));
    const { fetch, calls } = mockFetch(json(GATEWAY_RESPONSE));
    const error = await jev({
      provider: 'ai-sdk',
      model,
      failover: [{ provider: 'vercel-ai-gateway' }],
      fetch,
    })
      .score(humanAnalysis(), context())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevProviderError);
    expect((error as JevProviderError).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('validates the answers it gets back', async () => {
    evaluate.mockResolvedValue({ answers: { human: { type: 'boolean', probability: 'nope' } } });
    await expect(
      jev({ provider: 'ai-sdk', model }).score(humanAnalysis(), context()),
    ).rejects.toThrow(JevProviderError);
  });
});
