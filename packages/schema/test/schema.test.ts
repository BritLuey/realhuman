import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseClientResult,
  parseDecisionRecord,
  parseInitResponse,
  parsePayload,
  REASON_CODES,
  REASONS,
} from '../src/index.js';
import { validPayload, validRecord } from './fixtures.js';

describe('parsePayload', () => {
  it('accepts a well-formed payload', () => {
    const result = parsePayload(validPayload());
    expect(result.success).toBe(true);
  });

  it('drops unknown fields so newer browser SDKs work with older servers', () => {
    const result = parsePayload({ ...validPayload(), somethingNew: 42 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.output).not.toHaveProperty('somethingNew');
  });

  it('rejects a different schema version', () => {
    const result = parsePayload({ ...validPayload(), v: 2 });
    expect(result.success).toBe(false);
  });

  it('rejects malformed session ids', () => {
    expect(parsePayload({ ...validPayload(), sid: 'short' }).success).toBe(false);
    expect(parsePayload({ ...validPayload(), sid: 'has spaces in it......' }).success).toBe(false);
  });

  it('rejects out-of-range ratios and non-finite numbers', () => {
    const payload = validPayload();
    const pointer = payload.signals.pointer;
    if (!pointer) throw new Error('fixture must include pointer signals');

    expect(
      parsePayload({
        ...payload,
        signals: { ...payload.signals, pointer: { ...pointer, trustedRatio: 1.5 } },
      }).success,
    ).toBe(false);
    expect(
      parsePayload({
        ...payload,
        signals: { ...payload.signals, pointer: { ...pointer, speedMean: Number.NaN } },
      }).success,
    ).toBe(false);
  });

  it('limits context to 10 keys', () => {
    const context = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'x']));
    const result = parsePayload({ ...validPayload(), context });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.join(' ')).toContain('at most 10 keys');
  });

  it('reports the path of each issue', () => {
    const result = parsePayload({ ...validPayload(), seq: -1 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0]).toMatch(/^seq: /);
  });

  it('never throws, even for garbage input', () => {
    for (const input of [null, undefined, 'x', 42, [], { v: 1 }]) {
      expect(() => parsePayload(input)).not.toThrow();
      expect(parsePayload(input).success).toBe(false);
    }
  });
});

describe('parseInitResponse', () => {
  it('accepts a well-formed init response', () => {
    const result = parseInitResponse({
      v: 1,
      sid: 'k3J9x0aQ2mW8pL5rT7yB',
      nonce: 'v1.eyJzaWQiOiJrM0o5In0.c2ln',
      expiresAt: 1_790_000_000_000,
    });
    expect(result.success).toBe(true);
  });
});

describe('parseClientResult', () => {
  it('accepts a result with only some fields exposed', () => {
    expect(
      parseClientResult({ v: 1, sid: 'k3J9x0aQ2mW8pL5rT7yB', seq: 0, realHuman: 0.9 }).success,
    ).toBe(true);
  });

  it('rejects unknown verdicts', () => {
    expect(
      parseClientResult({ v: 1, sid: 'k3J9x0aQ2mW8pL5rT7yB', seq: 0, verdict: 'maybe' }).success,
    ).toBe(false);
  });
});

describe('parseDecisionRecord', () => {
  it('accepts a well-formed record', () => {
    expect(parseDecisionRecord(validRecord()).success).toBe(true);
  });

  it('accepts a no-JS record with no browser signals', () => {
    const record = { ...validRecord(), signals: null, kind: 'no_js', reasons: ['no_js'] };
    expect(parseDecisionRecord(record).success).toBe(true);
  });

  it('accepts records from older engines without labels', () => {
    const {
      label: _l,
      botEvidence: _b,
      humanEvidence: _h,
      primaryReason: _p,
      ...old
    } = validRecord();
    expect(parseDecisionRecord(old).success).toBe(true);
  });

  it('rejects unknown labels and evidence levels', () => {
    expect(parseDecisionRecord({ ...validRecord(), label: 'maybe' }).success).toBe(false);
    expect(parseDecisionRecord({ ...validRecord(), botEvidence: 'huge' }).success).toBe(false);
  });

  it('rejects unknown reason codes', () => {
    expect(parseDecisionRecord({ ...validRecord(), reasons: ['made_up'] }).success).toBe(false);
  });
});

describe('reason codes', () => {
  it('are all lower_snake_case', () => {
    for (const code of REASON_CODES) expect(code).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
  });

  it('all have a short title', () => {
    for (const code of REASON_CODES) {
      expect(REASONS[code].title.length).toBeGreaterThan(3);
      expect(REASONS[code].title.length).toBeLessThan(40);
    }
  });

  it('all have a description', () => {
    for (const code of REASON_CODES) expect(REASONS[code].description.length).toBeGreaterThan(10);
  });

  it('are all documented in docs/reference/reason-codes.md', () => {
    const docPath = fileURLToPath(
      new URL('../../../docs/reference/reason-codes.md', import.meta.url),
    );
    const doc = readFileSync(docPath, 'utf8');
    const missing = REASON_CODES.filter((code) => !doc.includes(`\`${code}\``));
    expect(missing).toEqual([]);
  });
});
