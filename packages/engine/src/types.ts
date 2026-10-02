import type { ReasonCode, ServerFacts, Signals } from '@realhuman/schema';
import type { Ja4Assessment, Ja4Parts } from './ja4.js';

export type EvidenceGroup = 'environment' | 'network' | 'behaviour';

/** One piece of weighted evidence. Negative weights point to automation, positive to a person. */
export interface Evidence {
  readonly code: ReasonCode;
  readonly group: EvidenceGroup;
  /** Log-odds contribution. */
  readonly weight: number;
}

/** Everything the engine learned about a session, before it decides. */
export interface Analysis {
  readonly signals: Signals | null;
  readonly server: ServerFacts;
  readonly ja4: Ja4Parts | null;
  readonly ja4Assessment: Ja4Assessment;
  /** Conclusive reasons. When non-empty, the session is a bot whatever else was seen. */
  readonly gates: readonly ReasonCode[];
  readonly evidence: readonly Evidence[];
  /** Context-only reasons such as `privacy_browser` or `no_interaction`. */
  readonly neutral: readonly ReasonCode[];
  readonly privacyBrowser: boolean;
  /** 0-1: how much behavioural and network evidence was available. */
  readonly coverage: { readonly behaviour: number; readonly network: number };
}
