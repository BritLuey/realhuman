import type { Kind, ReasonCode } from '@realhuman/schema';
import type { Analysis, EvidenceGroup, Scorer, ScorerContext, ScorerResult } from './scorer.js';

/** Starting log-odds before any evidence: most sessions that run JavaScript are people. */
export const PRIOR = 0.4;

/** Per-group limits, so one odd category (say, an unusual mouse) can't decide alone. */
export const GROUP_LIMITS: Readonly<Record<EvidenceGroup, readonly [number, number]>> = {
  environment: [-6, 0],
  network: [-5, 0],
  behaviour: [-5, 3.5],
};

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Scores an analysis with the weighted-evidence model. Pure and synchronous. */
export function scoreAlgorithmically(
  analysis: Analysis,
  thresholds: { human: number; bot: number },
): ScorerResult {
  const totals: Record<EvidenceGroup, number> = { environment: 0, network: 0, behaviour: 0 };
  for (const item of analysis.evidence) totals[item.group] += item.weight;

  let logOdds = PRIOR;
  let negative = 0;
  for (const group of Object.keys(totals) as EvidenceGroup[]) {
    const [min, max] = GROUP_LIMITS[group];
    const capped = clamp(totals[group], min, max);
    logOdds += capped;
    if (capped < 0) negative += capped;
  }

  const realHuman = round(sigmoid(logOdds));
  const confidence = round(
    clamp(
      0.15 +
        0.25 * analysis.coverage.network +
        0.55 * analysis.coverage.behaviour +
        Math.min(0.4, -negative / 10),
      0,
      0.99,
    ),
  );

  const reasons: ReasonCode[] = [...analysis.evidence.map((e) => e.code), ...analysis.neutral];
  return { realHuman, confidence, kind: inferKind(analysis, realHuman, thresholds), reasons };
}

function has(analysis: Analysis, code: ReasonCode): boolean {
  return analysis.evidence.some((e) => e.code === code);
}

export function inferKind(
  analysis: Analysis,
  realHuman: number,
  thresholds: { human: number; bot: number },
): Kind {
  if (realHuman > thresholds.bot && analysis.privacyBrowser) return 'privacy_browser';
  if (realHuman >= thresholds.human) return 'human';
  if (
    has(analysis, 'webdriver') ||
    has(analysis, 'synthetic_events') ||
    has(analysis, 'native_tamper')
  ) {
    return 'automation';
  }
  if (
    has(analysis, 'headless_markers') ||
    has(analysis, 'software_renderer') ||
    has(analysis, 'ua_ja4_mismatch') ||
    has(analysis, 'sec_fetch_missing')
  ) {
    return 'scraper';
  }
  if (!analysis.signals) return 'no_js';
  if (realHuman <= thresholds.bot) return 'automation';
  return 'unknown';
}

/** The built-in engine. */
export const algorithmicScorer: Scorer = {
  name: 'algorithmic',
  async score(analysis: Analysis, ctx: ScorerContext): Promise<ScorerResult> {
    return scoreAlgorithmically(analysis, ctx.thresholds);
  },
};
