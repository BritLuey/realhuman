import type {
  Analysis,
  Kind,
  ReasonCode,
  Scorer,
  ScorerContext,
  ScorerResult,
} from '@realhuman/engine';
import { isAbortError, JevProviderError } from './errors.js';
import {
  aiSdk,
  type BuiltInProviderName,
  DEFAULT_MODELS,
  type JevAnswers,
  type JevProvider,
  type JevRequest,
  typeSafeShaped,
  vercelAiGateway,
} from './providers.js';
import { KIND_OPTIONS, QUESTIONS, QUESTIONS_VERSION } from './questions.js';
import { buildState } from './state.js';

export const DEFAULT_TIMEOUT_MS = 800;

/** Model id used with a custom provider when `model` isn't given. */
const CUSTOM_PROVIDER_MODEL = 'jev-latest';

export interface JevFailover {
  readonly provider: Exclude<BuiltInProviderName, 'ai-sdk'> | JevProvider;
  readonly apiKeyEnv?: string;
  readonly model?: string;
  readonly baseUrl?: string;
}

export interface JevOptions {
  /** Where Jev is called. */
  readonly provider: BuiltInProviderName | JevProvider;
  /**
   * NAME of the environment variable holding the API key (never the key itself). Defaults:
   * `AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`, `TYPESAFE_AI_API_KEY`. Ignored for `'ai-sdk'`,
   * where the AI SDK provider reads its own key.
   */
  readonly apiKeyEnv?: string;
  /**
   * Model id, or an AI SDK evaluation model (for example `gateway.evaluationModel('typesafe-ai/jev')`)
   * with `'ai-sdk'`. Defaults: `typesafe-ai/jev` (gateway, ai-sdk), `typesafe/jev-latest`
   * (OpenRouter), `jev-latest` (TypeSafe).
   */
  readonly model?: string | object;
  /** Overall budget for every attempt, including failover. Default 800 ms. */
  readonly timeoutMs?: number;
  /** Providers to try, in order, when the previous one is unavailable (402, 429, 5xx, network). */
  readonly failover?: readonly JevFailover[];
  /** Ask Vercel AI Gateway to route only to zero-data-retention providers. Default true. */
  readonly zeroDataRetention?: boolean;
  /** Override the API base URL of `provider`, for example to go through a proxy. */
  readonly baseUrl?: string;
  /** Override fetch, for proxies and tests. */
  readonly fetch?: typeof fetch;
}

interface Attempt {
  readonly provider: JevProvider;
  readonly model: string;
}

const BUILT_IN = new Set<string>(['vercel-ai-gateway', 'openrouter', 'typesafe', 'ai-sdk']);

function isProvider(value: unknown): value is JevProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as JevProvider).name === 'string' &&
    typeof (value as JevProvider).evaluate === 'function'
  );
}

function modelIdOf(model: unknown): string | undefined {
  if (typeof model === 'string') return model;
  if (
    typeof model === 'object' &&
    model !== null &&
    'modelId' in model &&
    typeof model.modelId === 'string'
  ) {
    return model.modelId;
  }
  return undefined;
}

function resolveAttempt(
  entry: {
    provider: unknown;
    apiKeyEnv?: string | undefined;
    model?: unknown;
    baseUrl?: string | undefined;
  },
  shared: Pick<JevOptions, 'fetch' | 'zeroDataRetention'>,
  where: string,
): Attempt {
  const { provider, model } = entry;
  if (isProvider(provider)) {
    if (model !== undefined && typeof model !== 'string') {
      throw new TypeError(
        `[realhuman] jev: ${where}.model must be a string for a custom provider.`,
      );
    }
    return { provider, model: model ?? CUSTOM_PROVIDER_MODEL };
  }
  if (typeof provider !== 'string' || !BUILT_IN.has(provider)) {
    throw new TypeError(
      `[realhuman] jev: ${where}.provider must be 'vercel-ai-gateway', 'openrouter', 'typesafe', 'ai-sdk' or a provider object.`,
    );
  }
  const name = provider as BuiltInProviderName;

  if (name === 'ai-sdk') {
    if (
      model !== undefined &&
      typeof model !== 'string' &&
      (typeof model !== 'object' || model === null)
    ) {
      throw new TypeError(
        `[realhuman] jev: ${where}.model must be a model id or an AI SDK evaluation model.`,
      );
    }
    return {
      provider: aiSdk(typeof model === 'object' ? model : undefined, shared),
      model: modelIdOf(model) ?? (model === undefined ? DEFAULT_MODELS[name] : 'unknown'),
    };
  }

  if (model !== undefined && typeof model !== 'string') {
    throw new TypeError(`[realhuman] jev: ${where}.model must be a string for provider '${name}'.`);
  }
  const config = {
    ...(entry.apiKeyEnv !== undefined && { apiKeyEnv: entry.apiKeyEnv }),
    ...(entry.baseUrl !== undefined && { baseUrl: entry.baseUrl }),
    ...(shared.fetch !== undefined && { fetch: shared.fetch }),
    ...(shared.zeroDataRetention !== undefined && { zeroDataRetention: shared.zeroDataRetention }),
  };
  return {
    provider: name === 'vercel-ai-gateway' ? vercelAiGateway(config) : typeSafeShaped(name, config),
    model: model ?? DEFAULT_MODELS[name],
  };
}

/** Decides whether the next failover provider may be tried after `error`. */
function isRetryable(error: unknown): boolean {
  if (error instanceof JevProviderError) return error.retryable;
  // An abort that isn't the overall deadline (checked by the caller) is a per-attempt timeout.
  return isAbortError(error);
}

/** Runs each attempt in order until one answers, a non-retryable error occurs, or the deadline ends. */
async function evaluateWithFailover(
  attempts: readonly Attempt[],
  build: (model: string) => JevRequest,
  ctx: ScorerContext,
): Promise<{ answers: JevAnswers; attempt: Attempt }> {
  let lastError: unknown;
  for (const [index, attempt] of attempts.entries()) {
    ctx.signal.throwIfAborted();
    try {
      const answers = await attempt.provider.evaluate(build(attempt.model), {
        signal: ctx.signal,
        env: ctx.env,
      });
      return { answers, attempt };
    } catch (error) {
      if (ctx.signal.aborted || !isRetryable(error)) throw error;
      lastError = error;
      const next = attempts[index + 1];
      if (next) {
        ctx.logger.warn(
          `[realhuman] jev: ${attempt.provider.name} unavailable (${describe(error)}); trying ${next.provider.name}.`,
        );
      }
    }
  }
  throw lastError;
}

function describe(error: unknown): string {
  if (error instanceof JevProviderError && error.status !== undefined)
    return `HTTP ${error.status}`;
  return error instanceof Error ? error.message : String(error);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const KIND_SET: ReadonlySet<string> = new Set(KIND_OPTIONS);

/** Turns Jev's answers into a scorer result. Throws when the `human` answer is missing. */
export function toScorerResult(
  answers: JevAnswers,
  analysis: Analysis,
  ctx: Pick<ScorerContext, 'thresholds'>,
  attempt: { provider: string; model: string },
): ScorerResult {
  const human = answers.human;
  if (human?.type !== 'boolean') {
    throw new JevProviderError(`${attempt.provider} did not answer the 'human' question.`, {
      retryable: false,
    });
  }
  const p = clamp01(human.probability);
  const realHuman = round(p);

  const kindAnswer = answers.kind;
  let kind: Kind;
  let confidence = Math.abs(2 * p - 1);
  if (kindAnswer?.type === 'choice' && KIND_SET.has(kindAnswer.choice)) {
    kind = kindAnswer.choice as Kind;
    const probabilities = Object.values(kindAnswer.probabilities ?? {});
    if (probabilities.length > 0) confidence = Math.max(...probabilities);
  } else {
    kind = p >= ctx.thresholds.human ? 'human' : 'unknown';
  }

  const reasons: ReasonCode[] = [
    ...new Set<ReasonCode>([
      ...analysis.evidence.map((e) => e.code),
      ...analysis.neutral,
      'jev_decision',
    ]),
  ];
  return {
    realHuman,
    confidence: round(clamp01(confidence)),
    kind,
    reasons,
    model: attempt.model,
    provider: attempt.provider,
    questionsVersion: QUESTIONS_VERSION,
  };
}

/**
 * Creates the Jev engine. Pass the result as `engine` (or `shadow`) to `createRealHuman` or an
 * adapter. Gates, verified agents, the deadline and the algorithmic fallback are handled by the
 * engine; this scorer only asks Jev.
 *
 * @example
 * engine: jev({ provider: 'vercel-ai-gateway' })
 */
export function jev(options: JevOptions): Scorer {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError(
      '[realhuman] jev: options are required, for example jev({ provider: "vercel-ai-gateway" }).',
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
    throw new TypeError('[realhuman] jev: timeoutMs must be a positive number.');
  }
  const shared = {
    ...(options.fetch !== undefined && { fetch: options.fetch }),
    ...(options.zeroDataRetention !== undefined && {
      zeroDataRetention: options.zeroDataRetention,
    }),
  };

  const attempts: Attempt[] = [resolveAttempt(options, shared, 'options')];
  for (const [index, entry] of (options.failover ?? []).entries()) {
    if ((entry.provider as string) === 'ai-sdk') {
      throw new TypeError(
        `[realhuman] jev: 'ai-sdk' can't be used in failover; use it as the main provider.`,
      );
    }
    attempts.push(resolveAttempt(entry, shared, `failover[${index}]`));
  }

  return {
    name: 'jev',
    timeoutMs,
    async score(analysis, ctx) {
      const state = buildState(analysis);
      const { answers, attempt } = await evaluateWithFailover(
        attempts,
        (model) => ({ model, state, questions: QUESTIONS }),
        ctx,
      );
      return toScorerResult(answers, analysis, ctx, {
        provider: attempt.provider.name,
        model: attempt.model,
      });
    },
  };
}
