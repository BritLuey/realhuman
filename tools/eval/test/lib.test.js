import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auc,
  evaluate,
  histogram,
  latestPerSession,
  parseNdjson,
  roc,
  sessionsNeededForBound,
  wilson,
} from '../lib.js';

const rec = (sid, label, realHuman, extra = {}) => ({
  sid,
  seq: 0,
  ts: '2026-10-01T00:00:00.000Z',
  realHuman,
  verdict: realHuman >= 0.7 ? 'human' : realHuman <= 0.3 ? 'bot' : 'uncertain',
  confidence: 0.5,
  reasons: [],
  context: label ? { label, run: 'r1' } : {},
  ...extra,
});

test('wilson interval matches known values', () => {
  const w = wilson(8, 10);
  assert.equal(w.rate, 0.8);
  assert.ok(Math.abs(w.low - 0.4902) < 0.001, `low ${w.low}`);
  assert.ok(Math.abs(w.high - 0.9433) < 0.001, `high ${w.high}`);
  assert.equal(wilson(0, 0), null);
  assert.equal(wilson(0, 100).low, 0);
});

test('auc is 1 for perfect separation, 0.5 for identical scores', () => {
  assert.equal(auc([0.9, 0.8], [0.1, 0.2]), 1);
  assert.equal(auc([0.5, 0.5], [0.5, 0.5]), 0.5);
  assert.equal(auc([0.1], [0.9]), 0);
  assert.equal(auc([], [0.1]), null);
});

test('roc runs from (0,0) to (1,1)', () => {
  const points = roc([0.9, 0.8], [0.1, 0.2], 10);
  assert.deepEqual(points[0], { threshold: 0, tpr: 0, fpr: 0 });
  assert.deepEqual(points.at(-1), { threshold: 1, tpr: 1, fpr: 1 });
  assert.equal(points[3].tpr, 1); // threshold 0.3 catches both bots
  assert.equal(points[3].fpr, 0);
});

test('latest update per session wins', () => {
  const sessions = latestPerSession([
    rec('a', 'human', 0.4),
    rec('a', 'human', 0.9, { seq: 2 }),
    rec('b', 'bot', 0.1),
  ]);
  assert.equal(sessions.length, 2);
  assert.equal(sessions.find((s) => s.sid === 'a').realHuman, 0.9);
});

test('parseNdjson skips bad lines', () => {
  const { records, skipped } = parseNdjson(
    `${JSON.stringify(rec('a', 'human', 0.9))}\nnot json\n\n{"x":1}\n`,
  );
  assert.equal(records.length, 1);
  assert.equal(skipped, 2);
});

test('evaluate summarises labelled sessions and recomputes verdicts', () => {
  const records = [
    rec('h1', 'human', 0.95),
    rec('h2', 'human', 0.6),
    rec('h3', 'human', 0.2, { reasons: ['timezone_mismatch'] }),
    rec('b1', 'bot', 0.02, { context: { label: 'bot', scenario: 's1', run: 'r1' } }),
    rec('b2', 'bot', 0.8, {
      context: { label: 'bot', scenario: 's2', run: 'r1' },
      reasons: ['pointer_natural'],
    }),
    rec('u1', null, 0.5),
  ];
  const result = evaluate(records);
  assert.equal(result.sessions, 6);
  assert.equal(result.unlabelled, 1);
  assert.deepEqual(result.runs, ['r1']);
  assert.equal(result.humans.n, 3);
  assert.equal(result.humans.verdicts.bot, 1);
  assert.equal(result.humans.falsePositive.k, 1);
  assert.equal(result.humans.ruleOfThree, null);
  assert.deepEqual(result.humans.reasonsWhenNotHuman, [{ code: 'timezone_mismatch', count: 1 }]);
  assert.equal(result.bots.detected.k, 1);
  assert.equal(result.bots.passedAsHuman.k, 1);
  assert.deepEqual(
    result.scenarios.map((s) => [s.scenario, s.verdicts.bot]),
    [
      ['s1', 1],
      ['s2', 0],
    ],
  );
  // Stricter thresholds change verdicts without touching the records.
  assert.equal(evaluate(records, { human: 0.99, bot: 0.5 }).humans.verdicts.human, 0);
});

test('rule of three applies when no human was flagged', () => {
  const humans = Array.from({ length: 300 }, (_, i) => rec(`h${i}`, 'human', 0.9));
  const result = evaluate(humans);
  assert.equal(result.humans.ruleOfThree, 0.01);
  assert.equal(sessionsNeededForBound(0.01), 300);
});

test('histogram puts 1.0 in the last bin', () => {
  assert.deepEqual(histogram([0, 0.05, 0.95, 1]), [2, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
});
