import type { EnvReader } from '@realhuman/engine';
import { isAbortError, isRetryableStatus, JevProviderError } from './errors.js';
import type { JevQuestion } from './questions.js';

/** What a provider is asked. Boolean questions use `type: 'boolean'`; providers translate as needed. */
export interface JevRequest {
  readonly model: string;
  readonly state: unknown;
  readonly questions: Readonly<Record<string, JevQuestion>>;
}

export type JevAnswer =
  | { readonly type: 'boolean'; readonly probability: number }
  | {
      readonly type: 'choice';
      readonly choice: string;
      readonly probabilities?: Record<string, number>;
    };

export type JevAnswers = Record<string, JevAnswer>;

/**
 * Something that can ask Jev. Built-in providers implement this; pass your own for proxies or new
 * providers. Throw `JevProviderError` with `retryable: true` to let `failover` move on.
 */
export interface JevProvider {
  readonly name: string;
  evaluate(request: JevRequest, init: { signal: AbortSignal; env: EnvReader }): Promise<JevAnswers>;
}

export type BuiltInProviderName = 'vercel-ai-gateway' | 'openrouter' | 'typesafe' | 'ai-sdk';

export const DEFAULT_MODELS: Readonly<Record<BuiltInProviderName, string>> = {
  'vercel-ai-gateway': 'typesafe-ai/jev',
  openrouter: 'typesafe/jev-latest',
  typesafe: 'jev-latest',
  'ai-sdk': 'typesafe-ai/jev',
};

export const DEFAULT_KEY_ENVS: Readonly<
  Record<'vercel-ai-gateway' | 'openrouter' | 'typesafe', string>
> = {
  'vercel-ai-gateway': 'AI_GATEWAY_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  typesafe: 'TYPESAFE_AI_API_KEY',
};

const DEFAULT_BASE_URLS = {
  'vercel-ai-gateway': 'https://ai-gateway.vercel.sh/v1',
  // Not verified: OpenRouter's evaluation endpoint is assumed to follow TypeSafe's `/systemone`
  // shape. Override `baseUrl` if OpenRouter documents something else.
  openrouter: 'https://openrouter.ai/api/v1',
  typesafe: 'https://api.typesafe.ai/v1',
} as const;

export interface HttpProviderConfig {
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly zeroDataRetention?: boolean;
}

// ── Response validation ─────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function malformed(provider: string, detail: string): JevProviderError {
  return new JevProviderError(`${provider} returned an unexpected response: ${detail}.`, {
    retryable: false,
  });
}

/**
 * Checks a provider's `answers` object and normalises it. Accepts the AI Gateway / AI SDK shape
 * (`boolean` + `probability`) and the TypeSafe shape (`noul` + `noul`). Only the asked question
 * ids are read; anything malformed throws.
 */
export function parseAnswers(
  provider: string,
  answers: unknown,
  questions: Readonly<Record<string, JevQuestion>>,
): JevAnswers {
  if (!isRecord(answers)) throw malformed(provider, 'answers is missing');
  const result: JevAnswers = {};
  for (const id of Object.keys(questions)) {
    const answer = answers[id];
    if (answer === undefined) continue;
    if (!isRecord(answer)) throw malformed(provider, `answer '${id}' is not an object`);

    if (answer.type === 'boolean' || answer.type === 'noul') {
      const probability = answer.type === 'boolean' ? answer.probability : answer.noul;
      if (!isProbability(probability))
        throw malformed(provider, `answer '${id}' has no probability`);
      result[id] = { type: 'boolean', probability };
    } else if (answer.type === 'choice') {
      if (typeof answer.choice !== 'string')
        throw malformed(provider, `answer '${id}' has no choice`);
      let probabilities: Record<string, number> | undefined;
      if (answer.probabilities !== undefined && answer.probabilities !== null) {
        if (!isRecord(answer.probabilities))
          throw malformed(provider, `answer '${id}' has invalid probabilities`);
        probabilities = {};
        for (const [option, value] of Object.entries(answer.probabilities)) {
          if (!isProbability(value))
            throw malformed(provider, `answer '${id}' has invalid probabilities`);
          probabilities[option] = value;
        }
      }
      result[id] = {
        type: 'choice',
        choice: answer.choice,
        ...(probabilities && { probabilities }),
      };
    } else {
      throw malformed(provider, `answer '${id}' has unsupported type '${String(answer.type)}'`);
    }
  }
  return result;
}

// ── HTTP ────────────────────────────────────────────────────────────────────

function errorMessage(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.message === 'string') return body.message;
  if (isRecord(body.error) && typeof body.error.message === 'string') return body.error.message;
  if (typeof body.error === 'string') return body.error;
  return undefined;
}

function errorType(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.error_type === 'string') return body.error_type;
  if (isRecord(body.error) && typeof body.error.type === 'string') return body.error.type;
  return undefined;
}

/** POSTs JSON with Bearer auth. Classifies every failure as a `JevProviderError`. */
async function postJson(
  provider: string,
  url: string,
  apiKey: string,
  body: unknown,
  signal: AbortSignal,
  doFetch: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    // The overall deadline ended: stop, don't try another provider.
    if (signal.aborted) throw error;
    const kind = isAbortError(error) ? 'was aborted' : 'could not be reached';
    throw new JevProviderError(`${provider} ${kind}.`, { retryable: true, cause: error });
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (!response.ok) {
    const type = errorType(json);
    const message = errorMessage(json)?.slice(0, 200) ?? response.statusText;
    // A refusal is an answer about this request; another provider would refuse too.
    const refused = type !== undefined && /refus/i.test(type);
    throw new JevProviderError(
      `${provider} responded ${response.status}${type ? ` (${type})` : ''}: ${message}`,
      { status: response.status, retryable: !refused && isRetryableStatus(response.status) },
    );
  }
  if (json === undefined) throw malformed(provider, 'body is not JSON');
  if (isRecord(json) && typeof json.error_type === 'string') {
    throw new JevProviderError(
      `${provider} returned ${json.error_type}: ${errorMessage(json) ?? ''}`,
      {
        retryable: false,
      },
    );
  }
  return json;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function missingKey(provider: string, names: string): JevProviderError {
  return new JevProviderError(`${provider}: no API key. Set the environment variable ${names}.`, {
    retryable: false,
  });
}

/** Vercel AI Gateway, native evaluation API: `POST /v1/evaluate`. */
export function vercelAiGateway(config: HttpProviderConfig = {}): JevProvider {
  const name = 'vercel-ai-gateway';
  const keyEnv = config.apiKeyEnv ?? DEFAULT_KEY_ENVS[name];
  const url = `${trimSlash(config.baseUrl ?? DEFAULT_BASE_URLS[name])}/evaluate`;
  const zeroDataRetention = config.zeroDataRetention ?? true;
  return {
    name,
    async evaluate(request, { signal, env }) {
      // On Vercel, the project's OIDC token works when no gateway key is set.
      const apiKey = env(keyEnv) || env('VERCEL_OIDC_TOKEN');
      if (!apiKey) throw missingKey(name, `${keyEnv} (or run on Vercel with OIDC enabled)`);
      const body = {
        model: request.model,
        state: request.state,
        questions: request.questions,
        ...(zeroDataRetention && { providerOptions: { gateway: { zeroDataRetention: true } } }),
      };
      const json = await postJson(name, url, apiKey, body, signal, config.fetch ?? fetch);
      return parseAnswers(name, isRecord(json) ? json.answers : undefined, request.questions);
    },
  };
}

/** TypeSafe's wire format calls boolean questions `noul`. */
function toTypeSafeQuestions(
  questions: Readonly<Record<string, JevQuestion>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(questions)) {
    result[id] = question.type === 'boolean' ? { ...question, type: 'noul' } : question;
  }
  return result;
}

/**
 * TypeSafe-shaped API: `POST {base}/systemone`. Used for TypeSafe directly and for OpenRouter.
 *
 * The OpenRouter route is NOT verified against OpenRouter documentation; it assumes OpenRouter
 * mirrors TypeSafe's `/systemone` endpoint. Override `baseUrl` if that turns out to be wrong.
 */
export function typeSafeShaped(
  name: 'typesafe' | 'openrouter',
  config: HttpProviderConfig = {},
): JevProvider {
  const keyEnv = config.apiKeyEnv ?? DEFAULT_KEY_ENVS[name];
  const url = `${trimSlash(config.baseUrl ?? DEFAULT_BASE_URLS[name])}/systemone`;
  return {
    name,
    async evaluate(request, { signal, env }) {
      const apiKey = env(keyEnv);
      if (!apiKey) throw missingKey(name, keyEnv);
      const body = {
        model: request.model,
        state: request.state,
        questions: toTypeSafeQuestions(request.questions),
      };
      const json = await postJson(name, url, apiKey, body, signal, config.fetch ?? fetch);
      return parseAnswers(name, isRecord(json) ? json.answers : undefined, request.questions);
    },
  };
}

// ── AI SDK ──────────────────────────────────────────────────────────────────

/** The subset of the `ai` package used here, typed locally so `ai` stays an optional peer. */
interface AiModule {
  experimental_evaluate(options: {
    model: unknown;
    state: unknown;
    questions: unknown;
    maxRetries?: number;
    abortSignal?: AbortSignal;
    providerOptions?: Record<string, Record<string, unknown>>;
  }): Promise<{ answers: unknown }>;
}

/**
 * `ai` is an optional peer dependency. The specifier is held in a variable and marked ignore for
 * bundlers, so apps that don't use 'ai-sdk' build without `ai` installed.
 */
const AI_PACKAGE = 'ai';

async function loadAi(): Promise<AiModule> {
  try {
    return (await import(/* webpackIgnore: true */ /* @vite-ignore */ AI_PACKAGE)) as AiModule;
  } catch (error) {
    throw new JevProviderError(`provider 'ai-sdk' needs the 'ai' package (version 7 or later).`, {
      retryable: false,
      cause: error,
    });
  }
}

/** Uses the AI SDK's `experimental_evaluate`. `model` is an AI SDK evaluation model or a model id. */
export function aiSdk(
  model: unknown,
  config: Pick<HttpProviderConfig, 'zeroDataRetention'> = {},
): JevProvider {
  const name = 'ai-sdk';
  const zeroDataRetention = config.zeroDataRetention ?? true;
  return {
    name,
    async evaluate(request, { signal }) {
      const ai = await loadAi();
      let result: { answers: unknown };
      try {
        result = await ai.experimental_evaluate({
          model: model ?? request.model,
          state: request.state,
          questions: request.questions,
          // Failover and the deadline are handled here; the SDK's own retries would eat the budget.
          maxRetries: 0,
          abortSignal: signal,
          ...(zeroDataRetention && { providerOptions: { gateway: { zeroDataRetention: true } } }),
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw fromAiSdkError(name, error);
      }
      return parseAnswers(name, result.answers, request.questions);
    },
  };
}

/** Maps AI SDK errors (`APICallError` has `statusCode` and `isRetryable`) to `JevProviderError`. */
function fromAiSdkError(provider: string, error: unknown): JevProviderError {
  if (error instanceof JevProviderError) return error;
  // A RetryError wraps the last attempt's error; classify that one.
  const inner = isRecord(error) && isRecord(error.lastError) ? error.lastError : error;
  const fields: Record<string, unknown> = isRecord(inner) ? inner : {};
  const status = typeof fields.statusCode === 'number' ? fields.statusCode : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const retryable =
    status !== undefined
      ? isRetryableStatus(status)
      : fields.isRetryable === true || isAbortError(inner);
  return new JevProviderError(`${provider} failed: ${message}`, {
    ...(status !== undefined && { status }),
    retryable,
    cause: error,
  });
}
