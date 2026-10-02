// realHuman demo: serves a test page with the browser SDK and scores visits with the Node adapter.
//
//   pnpm --filter @realhuman/demo start      → http://localhost:3000
//
// Locally there is no CDN, so there's no JA4 fingerprint unless you send an `x-ja4` header yourself.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, normalize } from 'node:path';
import { createNodeHandler } from '@realhuman/node';

const require = createRequire(import.meta.url);
const port = Number(process.env.PORT ?? 3000);

if (!process.env.REALHUMAN_SECRET) {
  process.env.REALHUMAN_SECRET = randomBytes(32).toString('base64');
  console.log('[demo] REALHUMAN_SECRET not set: using a random secret for this run.');
}

/** Latest decision per session, newest first. */
const decisions = new Map();
/** Every record, for GET /export (used by the evaluation tool). */
const log = [];

const realHuman = createNodeHandler({
  deliver: 'both',
  clientFields: ['realHuman', 'verdict', 'kind', 'confidence'],
  ja4Header: process.env.DEMO_TRUST_JA4_HEADER ?? undefined,
  onDecision: (record) => {
    log.push(record);
    if (log.length > 50_000) log.shift();
    const previous = decisions.get(record.sid);
    if (!previous || previous.seq <= record.seq) {
      decisions.delete(record.sid);
      decisions.set(record.sid, record);
      while (decisions.size > 200) decisions.delete(decisions.keys().next().value);
    }
    console.log(
      `[demo] ${record.sid} #${record.seq}${record.final ? ' final' : ''} ${record.verdict.padEnd(9)} ${record.realHuman.toFixed(3)} ${record.reasons.join(',')}`,
    );
  },
});

const sdkPath = require.resolve('@realhuman/client/realhuman.iife.js');
const sdkDir = dirname(require.resolve('@realhuman/client'));

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>realHuman demo</title>
<style>
  :root { color-scheme: light dark; --fg:#1b1f24; --muted:#5b6470; --bg:#fbfbfc; --card:#fff; --line:#e3e6ea; --accent:#2457d6; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8eaed; --muted:#9aa3ad; --bg:#121417; --card:#1b1e22; --line:#2c3036; --accent:#7aa2ff; } }
  body { margin:0; font:16px/1.5 system-ui, sans-serif; color:var(--fg); background:var(--bg); }
  main { max-width:880px; margin:0 auto; padding:32px 16px 64px; }
  h1 { margin:0 0 4px; font-size:28px; } p.lead { color:var(--muted); margin:0 0 24px; }
  section { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; margin-bottom:16px; }
  .score { font-size:44px; font-weight:700; font-variant-numeric:tabular-nums; }
  .pill { display:inline-block; padding:2px 10px; border-radius:999px; border:1px solid var(--line); margin-left:8px; font-size:14px; }
  label { display:block; margin:12px 0 4px; } input, textarea { width:100%; box-sizing:border-box; padding:8px; font:inherit; border:1px solid var(--line); border-radius:8px; background:transparent; color:inherit; }
  button { margin-top:12px; padding:8px 16px; font:inherit; border-radius:8px; border:0; background:var(--accent); color:#fff; cursor:pointer; }
  table { width:100%; border-collapse:collapse; font-size:14px; } td, th { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  .muted { color:var(--muted); } code { font-size:13px; }
</style>
</head>
<body>
<main>
  <h1>realHuman demo</h1>
  <p class="lead">Move the mouse, scroll and type below, then press <b>Score now</b>. A final update is sent when you leave the page.</p>

  <section aria-live="polite">
    <div class="muted">Your latest score</div>
    <div><span class="score" id="score">…</span><span class="pill" id="verdict">waiting</span><span class="pill" id="confidence"></span></div>
    <div class="muted" id="sid"></div>
  </section>

  <section>
    <form data-realhuman id="signup" autocomplete="on">
      <label for="name">Name</label><input id="name" name="name" autocomplete="name">
      <label for="message">Message</label><textarea id="message" name="message" rows="3"></textarea>
      <button type="submit">Submit (scores, doesn't send anywhere)</button>
      <button type="button" id="score-now">Score now</button>
    </form>
  </section>

  <section>
    <div class="muted" style="margin-bottom:8px">Recent decisions (server-side records, including reason codes)</div>
    <table><thead><tr><th>Session</th><th>#</th><th>Score</th><th>Verdict</th><th>Reasons</th></tr></thead><tbody id="rows"></tbody></table>
  </section>
  <div style="height:60vh" class="muted">Scroll space.</div>
</main>
<script type="module">
  // Labels in the URL (?label=human&run=…) are copied into each record's context for evaluation.
  import { init } from '/sdk/index.js';
  const params = new URLSearchParams(location.search);
  const context = {};
  for (const key of ['label', 'run', 'scenario', 'participant']) {
    const value = params.get(key);
    if (value && /^[A-Za-z0-9_.-]{1,64}$/.test(value)) context[key] = value;
  }
  window.realHuman = init({ debug: true, context, honeypot: { trapLink: true, agentCanary: true } });
</script>
<script>
  const $ = (id) => document.getElementById(id);
  window.addEventListener('realhuman:result', (event) => {
    const r = event.detail;
    $('score').textContent = r.realHuman.toFixed(2);
    $('verdict').textContent = r.verdict;
    $('confidence').textContent = 'confidence ' + r.confidence.toFixed(2);
    $('sid').textContent = 'sid ' + r.sid + ' · update #' + r.seq;
  });
  $('score-now').addEventListener('click', () => window.realHuman && window.realHuman.score());
  $('signup').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (window.realHuman) await window.realHuman.score();
  });
  async function refresh() {
    try {
      const list = await (await fetch('/decisions')).json();
      $('rows').replaceChildren(...list.slice(0, 15).map((d) => {
        const tr = document.createElement('tr');
        for (const text of [d.sid.slice(0, 8) + '…', d.seq, d.realHuman.toFixed(3), d.verdict, d.reasons.join(', ')]) {
          const td = document.createElement('td'); td.textContent = String(text); tr.append(td);
        }
        return tr;
      }));
    } catch {}
  }
  refresh(); setInterval(refresh, 2000);
</script>
</body>
</html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/realhuman/')) {
    req.url = url.pathname.slice('/api/realhuman'.length) + url.search;
    return realHuman(req, res);
  }
  if (url.pathname === '/realhuman.js') {
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
    return res.end(readFileSync(sdkPath));
  }
  if (url.pathname.startsWith('/sdk/')) {
    const file = normalize(join(sdkDir, url.pathname.slice('/sdk/'.length)));
    if (!file.startsWith(sdkDir) || !file.endsWith('.js') || !existsSync(file))
      return res.writeHead(404).end();
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
    return res.end(readFileSync(file));
  }
  if (url.pathname === '/export') {
    const run = url.searchParams.get('run');
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
    const lines = log.filter((r) => !run || r.context.run === run).map((r) => JSON.stringify(r));
    return res.end(lines.length ? `${lines.join('\n')}\n` : '');
  }
  if (url.pathname === '/decisions') {
    const sid = url.searchParams.get('sid');
    const list = [...decisions.values()].reverse().filter((d) => !sid || d.sid === sid);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(list));
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page);
  }
  res.writeHead(404).end();
});

server.listen(port, () => console.log(`[demo] http://localhost:${port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    await realHuman.drain();
    process.exit(0);
  });
}
