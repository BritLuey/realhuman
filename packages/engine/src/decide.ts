import type {
  BotEvidence,
  EngineName,
  HumanEvidence,
  Kind,
  Label,
  ReasonCode,
  Verdict,
} from '@realhuman/schema';
import { inferKind, scoreAlgorithmically } from './algorithmic.js';
import {
  botEvidenceLevel,
  humanEvidenceLevel,
  labelFor,
  primaryReason,
  verdictForLabel,
} from './levels.js';
import type { Analysis } from './types.js';

export interface Decision {
  readonly realHuman: number;
  readonly label: Label;
  readonly verdict: Verdict;
  readonly kind: Kind;
  readonly confidence: number;
  readonly botEvidence: BotEvidence;
  readonly humanEvidence: HumanEvidence;
  readonly primaryReason: ReasonCode | null;
  readonly reasons: ReasonCode[];
  readonly engine: EngineName;
}

/** Score assigned when a gate fires. */
export const GATE_SCORE = 0.02;

const GATE_KIND: Partial<Record<ReasonCode, Kind>> = {
  agent_canary_followed: 'ai_agent',
  automation_markers: 'automation',
  honeypot_filled: 'automation',
  ua_bot: 'scraper',
  honeypot_trap_followed: 'scraper',
};

function unique(codes: readonly ReasonCode[]): ReasonCode[] {
  return [...new Set(codes)];
}

/**
 * Turns an analysis into a decision: evidence levels, label, verdict, kind, score and reasons.
 * Pure and synchronous.
 */
export function decide(analysis: Analysis): Decision {
  const reasons = unique([
    ...analysis.gates,
    ...analysis.evidence.map((e) => e.code),
    ...analysis.neutral,
  ]);
  const humanEvidence = humanEvidenceLevel(analysis);

  if (analysis.gates.length > 0) {
    let kind: Kind = 'unknown';
    for (const gate of analysis.gates) {
      const mapped = GATE_KIND[gate];
      if (mapped) {
        kind = mapped;
        break;
      }
    }
    return {
      realHuman: GATE_SCORE,
      label: 'bot',
      verdict: 'bot',
      kind,
      confidence: 0.95,
      botEvidence: 'conclusive',
      humanEvidence,
      primaryReason: analysis.gates[0] ?? null,
      reasons,
      engine: 'gate',
    };
  }

  const botEvidence = botEvidenceLevel(analysis);
  const label = labelFor(botEvidence, humanEvidence, analysis.server.verifiedAgent !== null);
  const score = scoreAlgorithmically(analysis);
  return {
    realHuman: score.realHuman,
    label,
    verdict: verdictForLabel(label),
    kind: inferKind(analysis, label),
    confidence: score.confidence,
    botEvidence,
    humanEvidence,
    primaryReason: primaryReason(analysis, label),
    reasons,
    engine: 'algorithmic',
  };
}
