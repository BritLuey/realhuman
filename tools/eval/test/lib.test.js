import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findings, renderHtml } from '../html.js';
import {
  auc,
  evaluate,
  histogram,
  labelOf,
  latestPerSession,
  parseNdjson,
  roc,
  sessionsNeededForBound,
  truthOf,
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

test('labels and analytics filters', () => {
  const withLabel = (sid, contextLabel, label) => ({
    ...rec(sid, contextLabel, 0.5),
    label,
  });
  const records = [
    withLabel('h1', 'human', 'human'),
    withLabel('h2', 'human', 'unverified'),
    withLabel('h3', 'human', 'suspicious'),
    withLabel('b1', 'bot', 'bot'),
    withLabel('b2', 'bot', 'suspicious'),
    withLabel('b3', 'bot', 'human'),
  ];
  const result = evaluate(records);
  assert.deepEqual(result.labels.human, {
    human: 1,
    unverified: 1,
    suspicious: 1,
    bot: 0,
    verified_agent: 0,
  });
  assert.equal(result.filters.standard.botsRemoved.k, 1);
  assert.equal(result.filters.standard.humansRemoved.k, 0);
  assert.equal(result.filters.standard.humansRemovedUpperBound, 1); // 3 / 3 humans
  assert.equal(result.filters.strict.botsRemoved.k, 2);
  assert.equal(result.filters.strict.humansRemoved.k, 1);
  assert.equal(result.filters.strict.humansRemovedUpperBound, null);
  assert.deepEqual(
    result.bots.reasonsWhenMissed,
    [],
    'b3 got through but has no reasons in this fixture',
  );
});

test('records from older engines get a label from their verdict', () => {
  assert.equal(labelOf({ verdict: 'uncertain' }), 'unverified');
  assert.equal(labelOf({ verdict: 'bot' }), 'bot');
  assert.equal(labelOf({ verdict: 'human', label: 'suspicious' }), 'suspicious');
});

test('ground truth comes from context.truth, with context.label as the older spelling', () => {
  const result = evaluate([
    { ...rec('a', null, 0.9), context: { truth: 'human' } },
    { ...rec('b', null, 0.1), context: { label: 'bot' } },
  ]);
  assert.equal(result.humans.n, 1);
  assert.equal(result.bots.n, 1);
  assert.equal(truthOf({ context: { truth: 'bot', label: 'human' } }), 'bot');
});

test('humans are broken down by browser, and missing data is counted', () => {
  const session = (sid, family, platform, label, extra = {}) => ({
    ...rec(sid, 'human', 0.5),
    label,
    server: {
      uaFamily: family,
      platform,
      ja4: 't13d1516h2_8daaf6152771_02713d6af862',
      clientHintsPresent: true,
    },
    signals: {
      env: { privacyBrowser: null, softwareRenderer: false, timezone: 'UTC' },
      pointer: { events: 20 },
      keyboard: null,
      touch: null,
      scroll: null,
    },
    ...extra,
  });
  const result = evaluate([
    session('a', 'chrome', 'windows', 'human'),
    session('b', 'chrome', 'windows', 'suspicious'),
    session('c', 'firefox', 'linux', 'unverified'),
    {
      ...session('d', 'firefox', 'linux', 'human'),
      signals: { ...session('x', '', '', '').signals, env: { privacyBrowser: 'firefox_rfp' } },
    },
  ]);
  const groups = Object.fromEntries(result.byBrowser.humans.map((g) => [g.group, g]));
  assert.equal(groups['chrome / windows'].n, 2);
  assert.equal(groups['chrome / windows'].strictRemoved.k, 1);
  assert.equal(groups['chrome / windows'].standardRemoved.k, 0);
  assert.equal(groups['firefox / linux'].n, 1);
  assert.equal(groups['firefox / linux (firefox_rfp)'].n, 1);
  const typing = result.availability.find((a) => a.check === 'Typing');
  assert.deepEqual(typing.humans, { missing: 4, n: 4 });
  const ja4 = result.availability.find((a) => a.check === 'TLS fingerprint (JA4)');
  assert.equal(ja4.humans.missing, 0);
});

test('findings name the most affected browser and missing TLS fingerprints', () => {
  const human = (sid, family, label, ja4 = 't13d1516h2_8daaf6152771_02713d6af862') => ({
    ...rec(sid, 'human', 0.5),
    label,
    server: { uaFamily: family, platform: 'windows', ja4 },
    signals: null,
  });
  const result = evaluate([
    human('a', 'chrome', 'human'),
    human('b', 'edge', 'suspicious', null),
    human('c', 'edge', 'human'),
  ]);
  const lines = findings(result);
  assert.ok(lines.some((l) => l.startsWith('Most affected browser: edge / windows')));
  assert.ok(lines.some((l) => l.startsWith('1 of 3 labelled sessions had no TLS fingerprint')));
  const html = renderHtml(result, { generatedAt: 'now', source: 'test' });
  assert.match(html, /Known humans by browser/);
  assert.match(html, /Data availability/);
});
