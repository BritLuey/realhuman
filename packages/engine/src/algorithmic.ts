import type { Kind, Label, ReasonCode } from '@realhuman/schema';
import type { Analysis, EvidenceGroup } from './types.js';

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

export interface Score {
  /** 0-1 ranking score: higher means more human-like evidence. Not a calibrated probability. */
  readonly realHuman: number;
  /** 0-1: how much evidence the score rests on. */
  readonly confidence: number;
}

/** Scores an analysis with the weighted-evidence model. Pure and synchronous. */
export function scoreAlgorithmically(analysis: Analysis): Score {
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

  return {
    realHuman: round(sigmoid(logOdds)),
    confidence: round(
      clamp(
        0.15 +
          0.25 * analysis.coverage.network +
          0.55 * analysis.coverage.behaviour +
          Math.min(0.4, -negative / 10),
        0,
        0.99,
      ),
    ),
  };
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
    has(analysis, 'renderer_platform_mismatch') ||
    has(analysis, 'ua_ja4_mismatch') ||
    has(analysis, 'ja4_non_browser') ||
    has(analysis, 'sec_fetch_missing')
  ) {
    return 'scraper';
  }
  if (!analysis.signals) return 'no_js';
  return label === 'bot' ? 'automation' : 'unknown';
}
