// Renders an evaluation (see lib.js) as a self-contained HTML report with inline SVG charts.

const pct = (value, digits = 1) =>
  value === null || value === undefined ? '–' : `${(value * 100).toFixed(digits)}%`;
const ci = (w) =>
  w ? `${pct(w.rate)} <span class="muted">(95% CI ${pct(w.low)}–${pct(w.high)})</span>` : '–';
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const rate = (w) => (w ? `${pct(w.rate)} (95% CI ${pct(w.low)}–${pct(w.high)})` : '–');
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** Below this many sessions, an upper bound from zero failures says too little to be worth stating. */
const MIN_SESSIONS_FOR_BOUND = 30;

/** One plain-English line per analytics filter. */
function filterLine(name, outcome, humans, bots) {
  const parts = [];
  if (bots.n > 0)
    parts.push(
      `removes ${outcome.botsRemoved.k} of ${count(bots.n, 'bot')}, ${rate(outcome.botsRemoved)}`,
    );
  if (humans.n > 0) {
    parts.push(
      `wrongly removes ${outcome.humansRemoved.k} of ${count(humans.n, 'human')}, ${rate(outcome.humansRemoved)}`,
    );
    if (outcome.humansRemovedUpperBound !== null && humans.n >= MIN_SESSIONS_FOR_BOUND) {
      parts.push(
        `with 95% confidence it removes fewer than ${pct(outcome.humansRemovedUpperBound)} of real people`,
      );
    }
  }
  return `${name}: ${parts.join('; ')}.`;
}

/** Plain-English findings, the part a non-specialist should read first. */
export function findings(result) {
  const lines = [];
  const { humans, bots } = result;
  if (bots.n === 0) lines.push('No labelled bot sessions: detection cannot be measured.');
  if (bots.n > 0 || humans.n > 0) {
    lines.push(
      filterLine("Standard filter (exclude label 'bot')", result.filters.standard, humans, bots),
    );
    lines.push(
      filterLine(
        "Strict filter (keep only 'human' and 'unverified')",
        result.filters.strict,
        humans,
        bots,
      ),
    );
  }
  if (humans.n > 0) {
    lines.push(
      `${result.labels.human.human} of ${count(humans.n, 'human session')} (${pct(result.labels.human.human / humans.n)}) ${result.labels.human.human === 1 ? 'was' : 'were'} confirmed 'human'; ${result.labels.human.unverified} ${result.labels.human.unverified === 1 ? 'was' : 'were'} 'unverified' (no interaction to confirm them).`,
    );
    if (humans.n < 300) {
      lines.push(
        `Only ${count(humans.n, 'human session')}: that's too few to show a false-positive rate below 1% (at least 300 sessions with no false positives are needed).`,
      );
    }
  } else {
    lines.push(
      'No labelled human sessions: the false-positive rate cannot be measured. Collect human sessions before relying on these results.',
    );
  }
  const worst = result.byBrowser.humans
    .filter((g) => g.strictRemoved.k > 0)
    .sort((a, b) => b.strictRemoved.rate - a.strictRemoved.rate || b.n - a.n)[0];
  if (worst) {
    lines.push(
      `Most affected browser: ${worst.group}, where the strict filter removes ${worst.strictRemoved.k} of ${worst.n} human sessions (${pct(worst.strictRemoved.rate)}). Check this group before relying on the strict filter.`,
    );
  }
  const labelled = humans.n + bots.n;
  const noJa4 = result.availability.find((a) => a.check === 'TLS fingerprint (JA4)');
  const missingJa4 = noJa4 ? noJa4.humans.missing + noJa4.bots.missing : 0;
  if (missingJa4 > 0) {
    lines.push(
      `${missingJa4} of ${count(labelled, 'labelled session')} had no TLS fingerprint (JA4), so the network checks didn't run for them.`,
    );
  }
  if (result.auc !== null) {
    lines.push(
      `AUC ${result.auc.toFixed(3)}: a randomly chosen human outscores a randomly chosen bot ${pct(result.auc)} of the time (1.0 = perfect separation, 0.5 = chance).`,
    );
  }
  return lines;
}

function rocChart(points) {
  const size = 260;
  const pad = 36;
  const x = (v) => pad + v * size;
  const y = (v) => pad + (1 - v) * size;
  const unique = [];
  for (const p of points) {
    const last = unique.at(-1);
    if (!last || last.fpr !== p.fpr || last.tpr !== p.tpr) unique.push(p);
  }
  const path = unique
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.fpr).toFixed(1)},${y(p.tpr).toFixed(1)}`)
    .join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return `<svg viewBox="0 0 ${size + pad * 2} ${size + pad * 2}" role="img" aria-label="ROC curve" class="chart">
    ${ticks
      .map(
        (
          t,
        ) => `<line x1="${x(t)}" y1="${y(0)}" x2="${x(t)}" y2="${y(1)}" class="grid"/><line x1="${x(0)}" y1="${y(t)}" x2="${x(1)}" y2="${y(t)}" class="grid"/>
    <text x="${x(t)}" y="${y(0) + 16}" text-anchor="middle">${t}</text><text x="${x(0) - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`,
      )
      .join('')}
    <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" class="diag"/>
    <path d="${path}" class="curve"/>
    <text x="${x(0.5)}" y="${size + pad * 2 - 4}" text-anchor="middle">humans flagged (false-positive rate)</text>
    <text transform="translate(12 ${y(0.5)}) rotate(-90)" text-anchor="middle">bots caught</text>
  </svg>`;
}

function histogramChart(human, bot) {
  const width = 420;
  const height = 200;
  const pad = 28;
  const bins = human.length;
  const humanTotal = human.reduce((a, b) => a + b, 0) || 1;
  const botTotal = bot.reduce((a, b) => a + b, 0) || 1;
  const maxShare = Math.max(
    ...human.map((v) => v / humanTotal),
    ...bot.map((v) => v / botTotal),
    0.01,
  );
  const bw = (width - pad * 2) / bins;
  const bar = (share, i, offset, cls) => {
    const h = (share / maxShare) * (height - pad * 2);
    return `<rect x="${pad + i * bw + offset}" y="${height - pad - h}" width="${bw / 2 - 2}" height="${h}" class="${cls}"><title>${pct(share)}</title></rect>`;
  };
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Score distribution" class="chart">
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="grid"/>
    ${human.map((v, i) => bar(v / humanTotal, i, 1, 'human')).join('')}
    ${bot.map((v, i) => bar(v / botTotal, i, bw / 2, 'bot')).join('')}
    ${[0, 0.5, 1].map((t) => `<text x="${pad + t * (width - pad * 2)}" y="${height - pad + 16}" text-anchor="middle">${t}</text>`).join('')}
    <text x="${width / 2}" y="${height - 2}" text-anchor="middle">realHuman score</text>
  </svg>
  <p class="legend"><span class="swatch human"></span> humans <span class="swatch bot"></span> bots (share of each group per bin)</p>`;
}

const reasonList = (reasons) =>
  reasons.length
    ? `<ul>${reasons.map((r) => `<li><code>${esc(r.code)}</code> × ${r.count}</li>`).join('')}</ul>`
    : '<p class="muted">None.</p>';

export function renderHtml(result, meta) {
  const { humans, bots } = result;
  const verdictRow = (label, group) =>
    `<tr><th>${label}</th><td>${group.n}</td><td>${group.verdicts.human}</td><td>${group.verdicts.uncertain}</td><td>${group.verdicts.bot}</td><td>${group.verdicts.verified_agent}</td><td>${group.meanScore === null ? '–' : group.meanScore.toFixed(3)}</td></tr>`;
  const labelRow = (name, n, counts) =>
    `<tr><th>${name}</th><td>${n}</td><td>${counts.human}</td><td>${counts.unverified}</td><td>${counts.suspicious}</td><td>${counts.bot}</td><td>${counts.verified_agent}</td></tr>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>realHuman evaluation</title>
<style>
  :root { color-scheme: light dark; --fg:#1b1f24; --muted:#5b6470; --bg:#fbfbfc; --card:#fff; --line:#e3e6ea; --human:#1f7a4d; --bot:#b3261e; --accent:#2457d6; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8eaed; --muted:#9aa3ad; --bg:#121417; --card:#1b1e22; --line:#2c3036; --human:#6fcf97; --bot:#ff8a80; --accent:#7aa2ff; } }
  body { margin:0; font:15px/1.55 system-ui, sans-serif; color:var(--fg); background:var(--bg); }
  main { max-width:900px; margin:0 auto; padding:28px 16px 48px; }
  h1 { margin:0 0 4px; font-size:26px; } h2 { font-size:18px; margin:0 0 12px; }
  section { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px 20px; margin-bottom:14px; overflow-x:auto; }
  .muted { color:var(--muted); } code { font-size:13px; }
  table { border-collapse:collapse; width:100%; font-size:14px; } th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px; }
  .chart { width:100%; height:auto; font-size:11px; fill:var(--muted); }
  .chart .grid { stroke:var(--line); } .chart .diag { stroke:var(--muted); stroke-dasharray:4 4; }
  .chart .curve { fill:none; stroke:var(--accent); stroke-width:2.5; }
  .chart rect.human, .swatch.human { fill:var(--human); background:var(--human); } .chart rect.bot, .swatch.bot { fill:var(--bot); background:var(--bot); }
  .swatch { display:inline-block; width:10px; height:10px; border-radius:2px; margin:0 4px 0 10px; }
  .legend { font-size:13px; color:var(--muted); margin:4px 0 0; }
  ul.findings li { margin-bottom:6px; }
</style>
</head>
<body>
<main>
  <h1>realHuman evaluation</h1>
  <p class="muted">Generated ${esc(meta.generatedAt)} · source ${esc(meta.source)}${meta.run ? ` · run ${esc(meta.run)}` : ''} · thresholds human ≥ ${result.thresholds.human}, bot ≤ ${result.thresholds.bot} · ${result.sessions} sessions (${result.unlabelled} unlabelled)</p>

  <section>
    <h2>Findings</h2>
    <ul class="findings">${findings(result)
      .map((line) => `<li>${esc(line)}</li>`)
      .join('')}</ul>
  </section>

  <section>
    <h2>Analytics filters</h2>
    <p class="muted">What each recommended filter would do to your data. You want many bots removed and almost no humans.</p>
    <table>
      <tr><th>Filter</th><th>Bots removed</th><th>Humans wrongly removed</th></tr>
      <tr><th>Standard: exclude <code>bot</code></th><td>${ci(result.filters.standard.botsRemoved)}</td><td>${ci(result.filters.standard.humansRemoved)}</td></tr>
      <tr><th>Strict: keep only <code>human</code> and <code>unverified</code></th><td>${ci(result.filters.strict.botsRemoved)}</td><td>${ci(result.filters.strict.humansRemoved)}</td></tr>
    </table>
  </section>

  <section>
    <h2>Results by label</h2>
    <table>
      <tr><th></th><th>Sessions</th><th>human</th><th>unverified</th><th>suspicious</th><th>bot</th><th>verified agent</th></tr>
      ${labelRow('Known humans', humans.n, result.labels.human)}
      ${labelRow('Known bots', bots.n, result.labels.bot)}
    </table>
  </section>

  <section>
    <h2>Known humans by browser</h2>
    <p class="muted">False positives hide in less common setups. Check every row, not just the total.</p>
    <table>
      <tr><th>Browser / platform</th><th>Sessions</th><th>human</th><th>unverified</th><th>suspicious</th><th>bot</th><th>Removed by standard</th><th>Removed by strict</th></tr>
      ${
        result.byBrowser.humans
          .map(
            (g) =>
              `<tr><td>${esc(g.group)}</td><td>${g.n}</td><td>${g.labels.human}</td><td>${g.labels.unverified}</td><td>${g.labels.suspicious}</td><td>${g.labels.bot}</td><td>${pct(g.standardRemoved?.rate ?? null)}</td><td>${pct(g.strictRemoved?.rate ?? null)}</td></tr>`,
          )
          .join('') || '<tr><td colspan="8" class="muted">No human sessions.</td></tr>'
      }
    </table>
  </section>

  <section>
    <h2>Data availability</h2>
    <p class="muted">How often each check had no data. Missing data counts as no evidence, never as bot evidence, but a check that's usually missing for your audience can't help much.</p>
    <table>
      <tr><th>Check</th><th>Missing for known humans</th><th>Missing for known bots</th></tr>
      ${result.availability
        .map(
          (a) =>
            `<tr><td>${esc(a.check)}</td><td>${a.humans.n ? `${a.humans.missing} of ${a.humans.n} (${pct(a.humans.missing / a.humans.n, 0)})` : '–'}</td><td>${a.bots.n ? `${a.bots.missing} of ${a.bots.n} (${pct(a.bots.missing / a.bots.n, 0)})` : '–'}</td></tr>`,
        )
        .join('')}
    </table>
  </section>

  <section>
    <h2>By bot scenario</h2>
    <table>
      <tr><th>Scenario</th><th>Sessions</th><th>bot</th><th>suspicious</th><th>unverified</th><th>human</th><th>Common reasons</th></tr>
      ${
        result.scenarios
          .map(
            (s) =>
              `<tr><td><code>${esc(s.scenario)}</code></td><td>${s.n}</td><td>${s.labels.bot}</td><td>${s.labels.suspicious}</td><td>${s.labels.unverified}</td><td>${s.labels.human}</td><td>${s.topReasons.map((r) => `<code>${esc(r.code)}</code>`).join(', ')}</td></tr>`,
          )
          .join('') || '<tr><td colspan="7" class="muted">No bot sessions.</td></tr>'
      }
    </table>
  </section>

  <div class="grid2">
    <section><h2>Why humans weren't confirmed</h2><p class="muted">Reason codes on known-human sessions not labelled <code>human</code>. Start tuning here.</p>${reasonList(humans.reasonsWhenNotHuman)}</section>
    <section><h2>Why bots got through</h2><p class="muted">Reason codes on known-bot sessions labelled <code>human</code> or <code>unverified</code>.</p>${reasonList(bots.reasonsWhenMissed)}</section>
  </div>

  <section>
    <h2>Score analysis</h2>
    <p class="muted">The <code>realHuman</code> score ranks sessions; it is not a probability. These numbers show how well it separates humans from bots at the thresholds human ≥ ${result.thresholds.human}, bot ≤ ${result.thresholds.bot}.</p>
    <table>
      <tr><th></th><th>Sessions</th><th>≥ human</th><th>between</th><th>≤ bot</th><th>verified agent</th><th>Mean score</th></tr>
      ${verdictRow('Known humans', humans)}
      ${verdictRow('Known bots', bots)}
      <tr><th>AUC</th><td colspan="6">${result.auc === null ? '–' : result.auc.toFixed(3)}</td></tr>
    </table>
  </section>

  <div class="grid2">
    <section><h2>ROC curve</h2>${rocChart(result.roc)}<p class="legend">Each point is a bot threshold. Top-left is best.</p></section>
    <section><h2>Score distribution</h2>${histogramChart(result.histogram.human, result.histogram.bot)}</section>
  </div>

  <section class="muted">
    <h2>How to read this</h2>
    <p>Each session counts once, using its latest update. Confidence intervals are Wilson score intervals at 95%. Ground truth comes from the test URL (<code>?truth=human</code>) and the bot lab, so this report is only as good as the labelling: run human tests with people you trust, on the devices and browsers your real visitors use. Calibrate on one run and confirm on a fresh one, so the numbers aren't tuned to a single sample.</p>
  </section>
</main>
</body>
</html>
`;
}
