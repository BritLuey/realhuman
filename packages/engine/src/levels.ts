import type { BotEvidence, HumanEvidence, Label, ReasonCode, Verdict } from '@realhuman/schema';
import type { Analysis } from './scorer.js';

/**
 * Cut-offs that turn weighted evidence into plain levels. Documented in
 * docs/guides/understanding-results.md; change them together with that page.
 */
export const LEVEL_CUTOFFS = {
  bot: {
    /** Total bot-leaning weight at or above which bot evidence is `moderate`. */
    moderate: 1.5,
    /** Total bot-leaning weight at or above which bot evidence is `strong`. */
    strong: 4,
    /** A single signal at least this heavy is `strong` on its own (e.g. `webdriver`). */
    strongSingle: 3.5,
  },
  human: {
    /** Total human-leaning weight at or above which human evidence is `strong`. */
    strong: 2,
  },
} as const;

/** How much evidence of automation the analysis contains. */
export function botEvidenceLevel(analysis: Analysis): BotEvidence {
  if (analysis.gates.length > 0) return 'conclusive';
  const weights = analysis.evidence.filter((e) => e.weight < 0).map((e) => -e.weight);
  if (weights.length === 0) return 'none';
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total >= LEVEL_CUTOFFS.bot.strong || Math.max(...weights) >= LEVEL_CUTOFFS.bot.strongSingle) {
    return 'strong';
  }
  if (total >= LEVEL_CUTOFFS.bot.moderate) return 'moderate';
  return 'weak';
}

/** How much evidence of a real person the analysis contains. */
export function humanEvidenceLevel(analysis: Analysis): HumanEvidence {
  const total = analysis.evidence.filter((e) => e.weight > 0).reduce((sum, e) => sum + e.weight, 0);
  if (total >= LEVEL_CUTOFFS.human.strong) return 'strong';
  if (total > 0) return 'some';
  return 'none';
}

/**
 * The label matrix. Bot evidence decides `bot` and `suspicious`; otherwise human evidence decides
 * between `human` and `unverified`.
 *
 * |                     | no human evidence | some / strong human evidence |
 * |---------------------|-------------------|------------------------------|
 * | none / weak bot     | unverified        | human                        |
 * | moderate bot        | suspicious        | suspicious                   |
 * | strong / conclusive | bot               | bot                          |
 */
export function labelFor(bot: BotEvidence, human: HumanEvidence, verifiedAgent: boolean): Label {
  if (verifiedAgent) return 'verified_agent';
  if (bot === 'conclusive' || bot === 'strong') return 'bot';
  if (bot === 'moderate') return 'suspicious';
  return human === 'none' ? 'unverified' : 'human';
}

/** The coarse verdict that corresponds to each label. */
export function verdictForLabel(label: Label): Verdict {
  if (label === 'human') return 'human';
  if (label === 'bot') return 'bot';
  if (label === 'verified_agent') return 'verified_agent';
  return 'uncertain';
}

/** The single reason that best explains a label, or null when nothing notable was seen. */
export function primaryReason(analysis: Analysis, label: Label): ReasonCode | null {
  if (label === 'verified_agent') return 'verified_agent_signature';
  const strongestBot = analysis.evidence.find((e) => e.weight < 0)?.code ?? null;
  const strongestHuman = analysis.evidence.find((e) => e.weight > 0)?.code ?? null;
  if (label === 'bot' || label === 'suspicious') return analysis.gates[0] ?? strongestBot;
  if (label === 'human') return strongestHuman;
  // unverified: say why there's no evidence, or point at the weak hint there was.
  if (analysis.neutral.includes('no_interaction')) return 'no_interaction';
  if (analysis.neutral.includes('no_js')) return 'no_js';
  return strongestBot;
}
