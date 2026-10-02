import type { DecisionRecord, ReasonCode } from '@realhuman/schema';
import { analyze } from './analysis.js';
import { decide } from './decide.js';
import type { EngineOptions } from './options.js';
import { VERSION } from './version.js';

/** Gates that depend on the original request (nonce, trap link) and can't be re-derived from a record. */
const CARRIED_GATES: readonly ReasonCode[] = [
  'nonce_invalid',
  'nonce_expired',
  'nonce_replayed',
  'too_fast',
  'honeypot_trap_followed',
];

export type RescoreOptions = Pick<EngineOptions, 'ja4'>;

/**
 * Re-scores a stored decision record with the current engine, using the signals and network
 * facts it contains. `sid`, `seq`, `final`, `ts`, `signals`, `server` and `context` are kept;
 * the label, evidence levels, score, verdict, kind, confidence, reasons and engine fields are
 * replaced. Fields that older engine versions wrote but this one doesn't are dropped.
 */
export function rescore(record: DecisionRecord, options: RescoreOptions = {}): DecisionRecord {
  const analysis = analyze({
    signals: record.signals,
    server: record.server,
    gates: record.reasons.filter((code) => CARRIED_GATES.includes(code)),
    ja4Lists: { browser: options.ja4?.browser ?? [], nonBrowser: options.ja4?.nonBrowser ?? [] },
  });
  const decision = decide(analysis);
  return {
    v: record.v,
    sid: record.sid,
    seq: record.seq,
    final: record.final,
    ts: record.ts,
    realHuman: decision.realHuman,
    verdict: decision.verdict,
    kind: decision.kind,
    confidence: decision.confidence,
    label: decision.label,
    botEvidence: decision.botEvidence,
    humanEvidence: decision.humanEvidence,
    primaryReason: decision.primaryReason,
    reasons: decision.reasons,
    engine: decision.engine,
    engineVersion: VERSION,
    server: record.server,
    signals: record.signals,
    context: record.context,
  };
}
