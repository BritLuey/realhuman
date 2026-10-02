import type { Kind, Label, ReasonCode } from '@realhuman/schema';
import { botEvidenceLevel, humanEvidenceLevel, labelFor } from './levels.js';
import type { Analysis, EvidenceGroup, Scorer, ScorerResult } from './scorer.js';

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

/**
 * Scores an analysis with the weighted-evidence model. Pure and synchronous.
 *
 * `realHuman` ranks sessions (higher = more human-like evidence). It is not a calibrated
 * probability; for filtering, use the label from `labelFor`.
 */
export function scoreAlgorithmically(analysis: Analysis): ScorerResult {
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

  const label = labelFor(
    botEvidenceLevel(analysis),
    humanEvidenceLevel(analysis),
    analysis.server.verifiedAgent !== null,
  );
  const reasons: ReasonCode[] = [...analysis.evidence.map((e) => e.code), ...analysis.neutral];
  return { realHuman, confidence, kind: inferKind(analysis, label), reasons };
}

function has(analysis: Analysis, code: ReasonCode): boolean {
  return analysis.evidence.some((e) => e.code === code);
}

/** What is most likely driving the session, given its label and evidence. */
export function inferKind(analysis: Analysis, label: Label): Kind {
  if (label === 'verified_agent') return 'verified_agent';
  if (label === 'human' || label === 'unverified') {
    if (analysis.privacyBrowser) return 'privacy_browser';
    if (label === 'human') return 'human';
    return analysis.signals ? 'unknown' : 'no_js';
  }
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
  return label === 'bot' ? 'automation' : 'unknown';
}

/** The built-in engine. */
export const algorithmicScorer: Scorer = {
  name: 'algorithmic',
  async score(analysis: Analysis): Promise<ScorerResult> {
    return scoreAlgorithmically(analysis);
  },
};
