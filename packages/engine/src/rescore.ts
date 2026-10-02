import type { DecisionRecord, ReasonCode } from '@realhuman/schema';
import { analyze } from './analysis.js';
import { decideWith } from './decide.js';
import { type EngineOptions, resolveOptions } from './options.js';
import { VERSION } from './version.js';

/** Gates that depend on the original request (nonce, trap link) and can't be re-derived from a record. */
const CARRIED_GATES: readonly ReasonCode[] = [
  'nonce_invalid',
  'nonce_expired',
  'nonce_replayed',
  'too_fast',
  'honeypot_trap_followed',
];

export type RescoreOptions = Pick<
  EngineOptions,
  'engine' | 'thresholds' | 'ja4' | 'env' | 'logger'
>;

/**
 * Re-scores a stored decision record with the current engine, using the signals and network
 * facts it contains. `sid`, `seq`, `final`, `ts`, `signals`, `server` and `context` are kept;
 * the score, verdict, kind, confidence, reasons and engine fields are replaced.
 */
export async function rescore(
  record: DecisionRecord,
  input: RescoreOptions = {},
): Promise<DecisionRecord> {
  const options = resolveOptions({ ...input, deliver: 'client' });
  const analysis = analyze({
    signals: record.signals,
    server: record.server,
    gates: record.reasons.filter((code) => CARRIED_GATES.includes(code)),
    ja4Lists: options.ja4,
  });
  const decision = await decideWith(options.engine, analysis, options);
  const { model: _m, provider: _p, questionsVersion: _q, shadow: _s, ...rest } = record;
  return {
    ...rest,
    realHuman: decision.realHuman,
    verdict: decision.verdict,
    kind: decision.kind,
    confidence: decision.confidence,
    reasons: decision.reasons,
    engine: decision.engine,
    engineVersion: VERSION,
    ...(decision.model !== undefined && { model: decision.model }),
    ...(decision.provider !== undefined && { provider: decision.provider }),
    ...(decision.questionsVersion !== undefined && { questionsVersion: decision.questionsVersion }),
  };
}
