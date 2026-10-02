import type { EngineName, Kind, ReasonCode, ShadowResult, Verdict } from '@realhuman/schema';
import { scoreAlgorithmically } from './algorithmic.js';
import type { ResolvedOptions, Thresholds } from './options.js';
import type { Analysis, Scorer, ScorerResult } from './scorer.js';

export interface Decision {
  readonly realHuman: number;
  readonly verdict: Verdict;
  readonly kind: Kind;
  readonly confidence: number;
  readonly reasons: ReasonCode[];
  readonly engine: EngineName;
  readonly model?: string;
  readonly provider?: string;
  readonly questionsVersion?: string;
}

export const DEFAULT_SCORER_TIMEOUT_MS = 800;

/** Score assigned when a gate fires. */
export const GATE_SCORE = 0.02;

const GATE_KIND: Partial<Record<ReasonCode, Kind>> = {
  agent_canary_followed: 'ai_agent',
  automation_markers: 'automation',
  honeypot_filled: 'automation',
  ja4_non_browser: 'scraper',
  ua_bot: 'scraper',
  honeypot_trap_followed: 'scraper',
};

export function verdictFor(realHuman: number, thresholds: Thresholds): Verdict {
  if (realHuman >= thresholds.human) return 'human';
  if (realHuman <= thresholds.bot) return 'bot';
  return 'uncertain';
}

function unique(codes: readonly ReasonCode[]): ReasonCode[] {
  return [...new Set(codes)];
}

function gateDecision(analysis: Analysis): Decision {
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
    verdict: 'bot',
    kind,
    confidence: 0.95,
    reasons: unique([
      ...analysis.gates,
      ...analysis.evidence.map((e) => e.code),
      ...analysis.neutral,
    ]),
    engine: 'gate',
  };
}

function isValidResult(result: ScorerResult): boolean {
  return (
    Number.isFinite(result.realHuman) &&
    result.realHuman >= 0 &&
    result.realHuman <= 1 &&
    Number.isFinite(result.confidence) &&
    result.confidence >= 0 &&
    result.confidence <= 1 &&
    Array.isArray(result.reasons)
  );
}

/** Runs one scorer with a deadline. Returns null if it failed, timed out or returned garbage. */
async function runWithDeadline(
  scorer: Scorer,
  analysis: Analysis,
  options: ResolvedOptions,
): Promise<ScorerResult | null> {
  const controller = new AbortController();
  const timeoutMs = scorer.timeoutMs ?? DEFAULT_SCORER_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort(new Error(`${scorer.name} timed out after ${timeoutMs} ms`));
        resolve(null);
      }, timeoutMs);
    });
    const result = await Promise.race([
      scorer.score(analysis, {
        signal: controller.signal,
        env: options.env,
        logger: options.logger,
        thresholds: options.thresholds,
        debug: options.debug,
      }),
      deadline,
    ]);
    if (result === null) {
      options.logger.warn(
        `[realhuman] ${scorer.name} engine timed out after ${timeoutMs} ms; using algorithmic.`,
      );
      return null;
    }
    if (!isValidResult(result)) {
      options.logger.warn(
        `[realhuman] ${scorer.name} engine returned an invalid result; using algorithmic.`,
      );
      return null;
    }
    return result;
  } catch (error) {
    options.logger.warn(`[realhuman] ${scorer.name} engine failed; using algorithmic.`, error);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fromResult(
  result: ScorerResult,
  engine: EngineName,
  analysis: Analysis,
  options: ResolvedOptions,
): Decision {
  const verified = analysis.server.verifiedAgent !== null;
  return {
    realHuman: result.realHuman,
    verdict: verified ? 'verified_agent' : verdictFor(result.realHuman, options.thresholds),
    kind: verified ? 'verified_agent' : result.kind,
    confidence: result.confidence,
    reasons: unique([
      ...result.reasons,
      ...(verified ? (['verified_agent_signature'] as const) : []),
    ]),
    engine,
    ...(result.model !== undefined && { model: result.model }),
    ...(result.provider !== undefined && { provider: result.provider }),
    ...(result.questionsVersion !== undefined && { questionsVersion: result.questionsVersion }),
  };
}

/** Produces a decision with the given scorer. Gates short-circuit; other engines fall back to algorithmic. */
export async function decideWith(
  scorer: Scorer,
  analysis: Analysis,
  options: ResolvedOptions,
): Promise<Decision> {
  if (analysis.gates.length > 0) return gateDecision(analysis);

  // Verified agents are labelled by their signature; no need to spend a model call on them.
  if (scorer.name === 'algorithmic' || analysis.server.verifiedAgent !== null) {
    return fromResult(
      scoreAlgorithmically(analysis, options.thresholds),
      'algorithmic',
      analysis,
      options,
    );
  }

  const result = await runWithDeadline(scorer, analysis, options);
  if (result) return fromResult(result, scorer.name, analysis, options);

  const fallback = scoreAlgorithmically(analysis, options.thresholds);
  return fromResult(
    { ...fallback, reasons: [...fallback.reasons, 'jev_unavailable'] },
    'algorithmic-fallback',
    analysis,
    options,
  );
}

export function toShadow(decision: Decision): ShadowResult {
  return {
    engine: decision.engine,
    realHuman: decision.realHuman,
    verdict: decision.verdict,
    reasons: decision.reasons,
  };
}
