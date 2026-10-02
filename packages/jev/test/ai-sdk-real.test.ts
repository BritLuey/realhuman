import { describe, expect, it, vi } from 'vitest';
import { jev, QUESTIONS } from '../src/index.js';
import { context, GATEWAY_RESPONSE, humanAnalysis } from './helpers.js';

/** Runs against the real `ai` package with a fake evaluation model, to check the SDK contract. */
describe("provider: 'ai-sdk' with the real ai package", () => {
  it('passes state, questions, signal and provider options through experimental_evaluate', async () => {
    const doEvaluate = vi.fn(async () => ({ answers: GATEWAY_RESPONSE.answers, warnings: [] }));
    const model = {
      specificationVersion: 'v4' as const,
      provider: 'test',
      modelId: 'typesafe-ai/jev',
      supportedQuestionTypes: ['choice', 'score', 'boolean'] as const,
      doEvaluate,
    };
    const ctx = context({});
    const result = await jev({ provider: 'ai-sdk', model }).score(humanAnalysis(), ctx);

    expect(doEvaluate).toHaveBeenCalledTimes(1);
    const options = (doEvaluate.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(options.questions).toEqual(QUESTIONS);
    expect(options.state).toMatchObject({ network: { uaFamily: 'chrome' } });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options.providerOptions).toEqual({ gateway: { zeroDataRetention: true } });
    expect(result).toMatchObject({
      realHuman: 0.931,
      kind: 'human',
      provider: 'ai-sdk',
      model: 'typesafe-ai/jev',
    });
  });
});
