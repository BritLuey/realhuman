import type { Kind, ReasonCode, ServerFacts, Signals } from '@realhuman/schema';
import type { Ja4Assessment, Ja4Parts } from './ja4.js';
import type { EnvReader, Logger, Thresholds } from './options.js';

export type EvidenceGroup = 'environment' | 'network' | 'behaviour';

/** One piece of weighted evidence. Negative weights point to automation, positive to a person. */
export interface Evidence {
  readonly code: ReasonCode;
  readonly group: EvidenceGroup;
  /** Log-odds contribution. */
  readonly weight: number;
}

/** Everything the engine learned about a session, before any scorer runs. */
export interface Analysis {
  readonly signals: Signals | null;
  readonly server: ServerFacts;
  readonly ja4: Ja4Parts | null;
  readonly ja4Assessment: Ja4Assessment;
  /** Conclusive reasons. When non-empty, no scorer runs. */
  readonly gates: readonly ReasonCode[];
  readonly evidence: readonly Evidence[];
  /** Context-only reasons such as `privacy_browser` or `no_interaction`. */
  readonly neutral: readonly ReasonCode[];
  readonly privacyBrowser: boolean;
  /** 0-1: how much behavioural and network evidence was available. */
  readonly coverage: { readonly behaviour: number; readonly network: number };
}

export interface ScorerContext {
  readonly signal: AbortSignal;
  readonly env: EnvReader;
  readonly logger: Logger;
  readonly thresholds: Thresholds;
  readonly debug: boolean;
}

export interface ScorerResult {
  /** 0-1, higher means more likely human. */
  readonly realHuman: number;
  /** 0-1, how much evidence the answer rests on. */
  readonly confidence: number;
  readonly kind: Kind;
  readonly reasons: readonly ReasonCode[];
  readonly model?: string;
  readonly provider?: string;
  readonly questionsVersion?: string;
}

/**
 * A decision-maker. The built-in algorithmic engine implements this, and so does `jev()` from
 * `@realhuman/jev`. Implement it yourself to plug in another model.
 *
 * `score` may throw or be aborted through `ctx.signal`; the engine then falls back to the
 * algorithmic scorer.
 */
export interface Scorer {
  readonly name: 'algorithmic' | 'jev';
  /** Hard time limit. Only honoured for non-algorithmic scorers. */
  readonly timeoutMs?: number;
  score(analysis: Analysis, ctx: ScorerContext): Promise<ScorerResult>;
}
