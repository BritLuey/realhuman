// Statistics for evaluating realHuman against labelled sessions.
//
// A record is labelled by its `context.label` ('human' or 'bot'), set from the demo page URL
// (`?label=human&run=…`) or by the bot lab. Unlabelled records are counted but not evaluated.

const VERDICTS = ['human', 'uncertain', 'bot', 'verified_agent'];

/** Parses NDJSON text. Blank and invalid lines are skipped and counted. */
export function parseNdjson(text) {
  const records = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value.sid === 'string' && typeof value.realHuman === 'number')
        records.push(value);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { records, skipped };
}

/** Keeps the latest update (highest seq) for each session: that's the session's final answer. */
export function latestPerSession(records) {
  const latest = new Map();
  for (const record of records) {
    const current = latest.get(record.sid);
    if (
      !current ||
      record.seq > current.seq ||
      (record.seq === current.seq && record.ts > current.ts)
    ) {
      latest.set(record.sid, record);
    }
  }
  return [...latest.values()];
}

/** Wilson score interval for k successes out of n, at 95% confidence by default. */
export function wilson(k, n, z = 1.96) {
  if (n === 0) return null;
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { k, n, rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/**
 * Area under the ROC curve: the probability that a randomly chosen human scores higher than a
 * randomly chosen bot (ties count half). 1 is perfect separation, 0.5 is a coin flip.
 */
export function auc(humanScores, botScores) {
  if (humanScores.length === 0 || botScores.length === 0) return null;
  const all = [
    ...humanScores.map((score) => ({ score, human: true })),
    ...botScores.map((score) => ({ score, human: false })),
  ].sort((a, b) => a.score - b.score);
  // Mann-Whitney U via average ranks, which handles ties.
  let rankSumHumans = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j].score === all[i].score) j++;
    const averageRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (all[k].human) rankSumHumans += averageRank;
    i = j;
  }
  const nh = humanScores.length;
  const u = rankSumHumans - (nh * (nh + 1)) / 2;
  return u / (nh * botScores.length);
}

/** ROC points: at each threshold t, sessions with realHuman <= t are called bots. */
export function roc(humanScores, botScores, steps = 100) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      threshold: t,
      tpr: botScores.length ? botScores.filter((s) => s <= t).length / botScores.length : 0,
      fpr: humanScores.length ? humanScores.filter((s) => s <= t).length / humanScores.length : 0,
    });
  }
  return points;
}

function verdictFor(record, thresholds) {
  if (record.verdict === 'verified_agent') return 'verified_agent';
  if (record.realHuman >= thresholds.human) return 'human';
  if (record.realHuman <= thresholds.bot) return 'bot';
  return 'uncertain';
}

function countVerdicts(records, thresholds) {
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  for (const record of records) counts[verdictFor(record, thresholds)]++;
  return counts;
}

function topReasons(records, limit = 10) {
  const counts = new Map();
  for (const record of records)
    for (const code of record.reasons ?? []) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, limit);
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/**
 * Evaluates labelled records. Verdicts are recomputed from `realHuman` with the given thresholds,
 * so you can test thresholds other than the ones used in production.
 */
export function evaluate(input, options = {}) {
  const thresholds = { human: options.human ?? 0.7, bot: options.bot ?? 0.3 };
  const sessions = latestPerSession(input);
  const humans = sessions.filter((r) => r.context?.label === 'human');
  const bots = sessions.filter((r) => r.context?.label === 'bot');
  const humanScores = humans.map((r) => r.realHuman);
  const botScores = bots.map((r) => r.realHuman);

  const humanVerdicts = countVerdicts(humans, thresholds);
  const botVerdicts = countVerdicts(bots, thresholds);

  const scenarioNames = [...new Set(bots.map((r) => r.context.scenario ?? 'unnamed'))].sort();
  const scenarios = scenarioNames.map((scenario) => {
    const group = bots.filter((r) => (r.context.scenario ?? 'unnamed') === scenario);
    const verdicts = countVerdicts(group, thresholds);
    return {
      scenario,
      n: group.length,
      verdicts,
      detected: wilson(verdicts.bot, group.length),
      meanScore: mean(group.map((r) => r.realHuman)),
      topReasons: topReasons(group, 4),
    };
  });

  return {
    thresholds,
    records: input.length,
    sessions: sessions.length,
    unlabelled: sessions.length - humans.length - bots.length,
    runs: [...new Set(sessions.map((r) => r.context?.run).filter(Boolean))].sort(),
    humans: {
      n: humans.length,
      verdicts: humanVerdicts,
      falsePositive: wilson(humanVerdicts.bot, humans.length),
      notConfirmedHuman: wilson(humans.length - humanVerdicts.human, humans.length),
      meanScore: mean(humanScores),
      meanConfidence: mean(humans.map((r) => r.confidence)),
      // With zero false positives in n sessions, the 95% upper bound is about 3/n ("rule of three").
      ruleOfThree: humans.length > 0 && humanVerdicts.bot === 0 ? 3 / humans.length : null,
      reasonsWhenNotHuman: topReasons(humans.filter((r) => verdictFor(r, thresholds) !== 'human')),
    },
    bots: {
      n: bots.length,
      verdicts: botVerdicts,
      detected: wilson(botVerdicts.bot, bots.length),
      passedAsHuman: wilson(botVerdicts.human, bots.length),
      meanScore: mean(botScores),
      reasonsWhenMissed: topReasons(bots.filter((r) => verdictFor(r, thresholds) !== 'bot')),
    },
    scenarios,
    auc: auc(humanScores, botScores),
    roc: roc(humanScores, botScores),
    histogram: {
      human: histogram(humanScores),
      bot: histogram(botScores),
    },
  };
}

/** Counts of scores in ten bins: [0, 0.1), [0.1, 0.2) … [0.9, 1]. */
export function histogram(scores, bins = 10) {
  const counts = new Array(bins).fill(0);
  for (const score of scores) counts[Math.min(bins - 1, Math.floor(score * bins))]++;
  return counts;
}

/** How many sessions with zero false positives are needed to claim a false-positive rate below `rate`. */
export function sessionsNeededForBound(rate) {
  return Math.ceil(3 / rate);
}
