import {
  CLIENT_FIELDS,
  type ClientField,
  DELIVERY_MODES,
  type DecisionRecord,
  type DeliveryMode,
  MAX_PAYLOAD_BYTES,
} from '@realhuman/schema';
import { algorithmicScorer } from './algorithmic.js';
import type { Scorer } from './scorer.js';

export type EnvReader = (name: string) => string | undefined;

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface Thresholds {
  /** realHuman at or above this is `human`. */
  readonly human: number;
  /** realHuman at or below this is `bot`. */
  readonly bot: number;
}

export interface WebBotAuthOptions {
  /**
   * Origins of agents whose key directories may be fetched, e.g. `['https://chatgpt.com']`.
   * Signatures from any other agent are ignored. Empty (the default) turns verification off.
   */
  readonly agents?: readonly string[];
  /**
   * The host name visitors use to reach your site. Needed when the engine sits behind a CDN that
   * rewrites the Host header (for example CloudFront → Lambda function URL).
   */
  readonly authority?: string;
  /** Override fetch (for proxies and tests). */
  readonly fetch?: typeof fetch;
}

export interface EngineOptions {
  /** Who decides. Default `'algorithmic'`. Pass `jev({...})` from `@realhuman/jev` to use Jev. */
  readonly engine?: 'algorithmic' | Scorer;
  /** A second engine whose answer is stored in `record.shadow`. */
  readonly shadow?: 'algorithmic' | Scorer;
  /** Who receives results. Default `'server'`. */
  readonly deliver?: DeliveryMode;
  /** Result fields the browser may see. Default `['realHuman', 'verdict', 'confidence']`. */
  readonly clientFields?: readonly ClientField[];
  /** Receives every decision record. */
  readonly onDecision?: (record: DecisionRecord) => void | Promise<void>;
  /** Default 10 000 ms. */
  readonly onDecisionTimeoutMs?: number;
  /** Default `{ human: 0.7, bot: 0.3 }`. */
  readonly thresholds?: Partial<Thresholds>;
  /** Name of the env variable holding the signing secret. Default `'REALHUMAN_SECRET'`. */
  readonly secretEnv?: string;
  /** Name of the env variable holding the previous secret during rotation. Default `'REALHUMAN_SECRET_PREVIOUS'`. */
  readonly previousSecretEnv?: string;
  /** Nonce lifetime. Default 15 minutes. */
  readonly nonceTtlMs?: number;
  /** Default 16 384 bytes. */
  readonly maxPayloadBytes?: number;
  /** Extra origins allowed to call the endpoint cross-origin. Default none. */
  readonly allowedOrigins?: readonly string[];
  /** Web Bot Auth verification for self-identifying AI agents. */
  readonly webBotAuth?: WebBotAuthOptions;
  /** Exact JA4 values you know to be browsers or non-browsers. */
  readonly ja4?: { readonly browser?: readonly string[]; readonly nonBrowser?: readonly string[] };
  /** How environment variables are read. Adapters supply a default. */
  readonly env?: EnvReader;
  /** Where realHuman writes its own logs. Default `console`. */
  readonly logger?: Logger;
  /** Verbose logging. */
  readonly debug?: boolean;
  /** Clock override, for tests. */
  readonly now?: () => number;
}

export interface ResolvedOptions {
  readonly engine: Scorer;
  readonly shadow: Scorer | null;
  readonly deliver: DeliveryMode;
  readonly clientFields: readonly ClientField[];
  readonly onDecision: ((record: DecisionRecord) => void | Promise<void>) | null;
  readonly onDecisionTimeoutMs: number;
  readonly thresholds: Thresholds;
  readonly secretEnv: string;
  readonly previousSecretEnv: string;
  readonly nonceTtlMs: number;
  readonly maxPayloadBytes: number;
  readonly allowedOrigins: readonly string[];
  readonly webBotAuth: Required<Pick<WebBotAuthOptions, 'agents'>> & WebBotAuthOptions;
  readonly ja4: { readonly browser: readonly string[]; readonly nonBrowser: readonly string[] };
  readonly env: EnvReader;
  readonly logger: Logger;
  readonly debug: boolean;
  readonly now: () => number;
}

export const DEFAULT_CLIENT_FIELDS: readonly ClientField[] = [
  'realHuman',
  'label',
  'verdict',
  'confidence',
];

export function defaultEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

function resolveScorer(value: 'algorithmic' | Scorer | undefined): Scorer {
  if (value === undefined || value === 'algorithmic') return algorithmicScorer;
  if (typeof value === 'object' && typeof value.score === 'function') return value;
  throw new TypeError(`[realhuman] engine must be 'algorithmic' or a scorer such as jev({...}).`);
}

/** Applies defaults and validates. Throws a TypeError for invalid configuration. */
export function resolveOptions(options: EngineOptions = {}): ResolvedOptions {
  const deliver = options.deliver ?? 'server';
  if (!DELIVERY_MODES.includes(deliver)) {
    throw new TypeError(`[realhuman] deliver must be one of ${DELIVERY_MODES.join(', ')}.`);
  }

  const clientFields = options.clientFields ?? DEFAULT_CLIENT_FIELDS;
  for (const field of clientFields) {
    if (!CLIENT_FIELDS.includes(field)) {
      throw new TypeError(
        `[realhuman] clientFields may only contain ${CLIENT_FIELDS.join(', ')}; got '${String(field)}'.`,
      );
    }
  }

  const thresholds = { human: 0.7, bot: 0.3, ...options.thresholds };
  if (
    !(thresholds.bot >= 0 && thresholds.human <= 1 && thresholds.bot < thresholds.human) ||
    Number.isNaN(thresholds.bot) ||
    Number.isNaN(thresholds.human)
  ) {
    throw new TypeError('[realhuman] thresholds must satisfy 0 <= bot < human <= 1.');
  }

  const positive = (name: string, value: number | undefined, fallback: number): number => {
    const result = value ?? fallback;
    if (!(Number.isFinite(result) && result > 0)) {
      throw new TypeError(`[realhuman] ${name} must be a positive number.`);
    }
    return result;
  };

  const shadow = options.shadow === undefined ? null : resolveScorer(options.shadow);

  return {
    engine: resolveScorer(options.engine),
    shadow,
    deliver,
    clientFields,
    onDecision: options.onDecision ?? null,
    onDecisionTimeoutMs: positive('onDecisionTimeoutMs', options.onDecisionTimeoutMs, 10_000),
    thresholds,
    secretEnv: options.secretEnv ?? 'REALHUMAN_SECRET',
    previousSecretEnv: options.previousSecretEnv ?? 'REALHUMAN_SECRET_PREVIOUS',
    nonceTtlMs: positive('nonceTtlMs', options.nonceTtlMs, 15 * 60_000),
    maxPayloadBytes: positive('maxPayloadBytes', options.maxPayloadBytes, MAX_PAYLOAD_BYTES),
    allowedOrigins: (options.allowedOrigins ?? []).map((origin) => origin.replace(/\/+$/, '')),
    webBotAuth: { ...options.webBotAuth, agents: options.webBotAuth?.agents ?? [] },
    ja4: { browser: options.ja4?.browser ?? [], nonBrowser: options.ja4?.nonBrowser ?? [] },
    env: options.env ?? defaultEnv,
    logger: options.logger ?? console,
    debug: options.debug ?? false,
    now: options.now ?? Date.now,
  };
}
