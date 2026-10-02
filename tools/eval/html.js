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

/** Plain-English findings, the part a non-specialist should read first. */
export function findings(result) {
  const lines = [];
  const { humans, bots, thresholds } = result;
  if (bots.n > 0) {
    lines.push(
      `Of ${bots.n} automated sessions, ${bots.verdicts.bot} (${pct(bots.detected.rate)}, 95% CI ${pct(bots.detected.low)}–${pct(bots.detected.high)}) were scored as bots (realHuman ≤ ${thresholds.bot}), and ${bots.verdicts.human} passed as human.`,
    );
  } else lines.push('No labelled bot sessions: detection rate cannot be measured.');
  if (humans.n > 0) {
    lines.push(
      `Of ${humans.n} human sessions, ${humans.verdicts.bot} (${pct(humans.falsePositive.rate)}, 95% CI ${pct(humans.falsePositive.low)}–${pct(humans.falsePositive.high)}) were wrongly scored as bots, and ${humans.verdicts.human} (${pct(humans.verdicts.human / humans.n)}) were confirmed human (realHuman ≥ ${thresholds.human}).`,
    );
    if (humans.ruleOfThree !== null) {
      lines.push(
        `No human was scored as a bot. With 95% confidence the false-positive rate is below ${pct(humans.ruleOfThree)} (rule of three: 3 ÷ ${humans.n}).`,
      );
    }
    if (humans.n < 300) {
      lines.push(
        `Only ${humans.n} human sessions: that's too few to show a false-positive rate below 1% (at least 300 sessions with no false positives are needed).`,
      );
    }
  } else {
    lines.push(
      'No labelled human sessions: the false-positive rate cannot be measured. Collect human sessions before relying on these results.',
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
    <h2>Headline numbers</h2>
    <table>
      <tr><th>Bots caught</th><td>${ci(bots.detected)}</td></tr>
      <tr><th>Bots that passed as human</th><td>${ci(bots.passedAsHuman)}</td></tr>
      <tr><th>Humans wrongly flagged as bots</th><td>${ci(humans.falsePositive)}</td></tr>
      <tr><th>Humans not confirmed as human</th><td>${ci(humans.notConfirmedHuman)}</td></tr>
      <tr><th>AUC</th><td>${result.auc === null ? '–' : result.auc.toFixed(3)}</td></tr>
    </table>
  </section>

  <section>
    <h2>Verdicts</h2>
    <table>
      <tr><th></th><th>Sessions</th><th>human</th><th>uncertain</th><th>bot</th><th>verified agent</th><th>Mean score</th></tr>
      ${verdictRow('Labelled human', humans)}
      ${verdictRow('Labelled bot', bots)}
    </table>
  </section>

  <div class="grid2">
    <section><h2>ROC curve</h2>${rocChart(result.roc)}<p class="legend">Each point is a bot threshold. Top-left is best.</p></section>
    <section><h2>Score distribution</h2>${histogramChart(result.histogram.human, result.histogram.bot)}</section>
  </div>

  <section>
    <h2>By bot scenario</h2>
    <table>
      <tr><th>Scenario</th><th>Sessions</th><th>Caught</th><th>Uncertain</th><th>Passed as human</th><th>Mean score</th><th>Common reasons</th></tr>
      ${
        result.scenarios
          .map(
            (s) =>
              `<tr><td><code>${esc(s.scenario)}</code></td><td>${s.n}</td><td>${s.verdicts.bot} (${pct(s.detected?.rate ?? null, 0)})</td><td>${s.verdicts.uncertain}</td><td>${s.verdicts.human}</td><td>${s.meanScore === null ? '–' : s.meanScore.toFixed(3)}</td><td>${s.topReasons.map((r) => `<code>${esc(r.code)}</code>`).join(', ')}</td></tr>`,
          )
          .join('') || '<tr><td colspan="7" class="muted">No bot sessions.</td></tr>'
      }
    </table>
  </section>

  <div class="grid2">
    <section><h2>Why humans weren't confirmed</h2><p class="muted">Reason codes on human sessions that scored below the human threshold. Start tuning here.</p>${reasonList(humans.reasonsWhenNotHuman)}</section>
    <section><h2>Why bots got through</h2><p class="muted">Reason codes on bot sessions that weren't scored as bots.</p>${reasonList(bots.reasonsWhenMissed)}</section>
  </div>

  <section class="muted">
    <h2>How to read this</h2>
    <p>Each session counts once, using its latest update. Confidence intervals are Wilson score intervals at 95%. Labels come from the test URL (<code>?label=human</code>) and the bot lab, so this report is only as good as the labelling: run human tests with people you trust, on the devices and browsers your real visitors use. Calibrate on one run and confirm on a fresh one, so the numbers aren't tuned to a single sample.</p>
  </section>
</main>
</body>
</html>
`;
}
