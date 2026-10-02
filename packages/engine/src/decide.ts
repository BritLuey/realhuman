import type {
  BotEvidence,
  EngineName,
  HumanEvidence,
  Kind,
  Label,
  ReasonCode,
  ShadowResult,
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
import type { ResolvedOptions } from './options.js';
import type { Analysis, Scorer, ScorerResult } from './scorer.js';

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
    label: 'bot',
    verdict: 'bot',
    kind,
    confidence: 0.95,
    botEvidence: 'conclusive',
    humanEvidence: humanEvidenceLevel(analysis),
    primaryReason: analysis.gates[0] ?? null,
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

/**
 * Turns a scorer's result into a decision. The label always starts from the evidence levels.
 * A model (Jev) can then move an open case: a probability at or below `thresholds.bot` makes it
 * `bot`, and one at or above `thresholds.human` turns `unverified` into `human`.
 */
function fromResult(
  result: ScorerResult,
  engine: EngineName,
  analysis: Analysis,
  options: ResolvedOptions,
): Decision {
  const verified = analysis.server.verifiedAgent !== null;
  const botEvidence = botEvidenceLevel(analysis);
  const humanEvidence = humanEvidenceLevel(analysis);
  let label = labelFor(botEvidence, humanEvidence, verified);
  let primary = primaryReason(analysis, label);

  const byModel = engine === 'jev';
  if (byModel && label !== 'bot' && label !== 'verified_agent') {
    if (result.realHuman <= options.thresholds.bot) {
      label = 'bot';
      primary = 'jev_decision';
    } else if (result.realHuman >= options.thresholds.human && label === 'unverified') {
      label = 'human';
      primary = 'jev_decision';
    }
  }

  return {
    realHuman: result.realHuman,
    label,
    verdict: verdictForLabel(label),
    kind: verified ? 'verified_agent' : byModel ? result.kind : inferKind(analysis, label),
    confidence: result.confidence,
    botEvidence,
    humanEvidence,
    primaryReason: primary,
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
    return fromResult(scoreAlgorithmically(analysis), 'algorithmic', analysis, options);
  }

  const result = await runWithDeadline(scorer, analysis, options);
  if (result) return fromResult(result, scorer.name, analysis, options);

  const fallback = scoreAlgorithmically(analysis);
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
    label: decision.label,
    verdict: decision.verdict,
    reasons: decision.reasons,
  };
}
