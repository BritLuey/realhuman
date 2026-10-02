#!/usr/bin/env node
// realHuman evaluation report.
//
//   # From exported files (NDJSON, one decision record per line):
//   pnpm --filter @realhuman/eval report -- records.ndjson
//
//   # Straight from a deployed Vercel demo (needs DEMO_ADMIN_TOKEN) or the local demo:
//   DEMO_ADMIN_TOKEN=… pnpm --filter @realhuman/eval report -- --url=https://your-demo.vercel.app --run=pilot-1
//   pnpm --filter @realhuman/eval report -- --url=http://localhost:3000
//
// Options: --run=<id> (only that run) · --human=0.7 --bot=0.3 (thresholds) · --out=report.html · --json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findings, renderHtml } from './html.js';
import { evaluate, parseNdjson } from './lib.js';

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const files = args.filter((a) => !a.startsWith('--'));
const url = option('url')?.replace(/\/+$/, '');
const run = option('run');
const out = resolve(option('out') ?? 'eval-report.html');
const thresholds = {
  human: option('human') ? Number(option('human')) : 0.7,
  bot: option('bot') ? Number(option('bot')) : 0.3,
};

if (!url && files.length === 0) {
  console.error(
    'Give NDJSON files, or --url=<demo> to download records. See the comment at the top of report.js.',
  );
  process.exit(2);
}

async function download() {
  const token = process.env.DEMO_ADMIN_TOKEN ?? process.env.REALHUMAN_EVAL_TOKEN;
  const query = run ? `?run=${encodeURIComponent(run)}` : '';
  // Vercel demo first, then the local demo.
  for (const path of ['/api/export', '/export']) {
    const response = await fetch(`${url}${path}${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (response.status === 404) continue;
    if (response.status === 401)
      throw new Error('Unauthorized: set DEMO_ADMIN_TOKEN to the value configured on the demo.');
    if (response.status === 501)
      throw new Error('The demo has no store: connect Upstash Redis to it first.');
    if (!response.ok) throw new Error(`Export failed: HTTP ${response.status}`);
    return response.text();
  }
  throw new Error(`No export endpoint found at ${url}.`);
}

const texts = url ? [await download()] : files.map((file) => readFileSync(file, 'utf8'));
let skipped = 0;
const records = [];
for (const text of texts) {
  const parsed = parseNdjson(text);
  skipped += parsed.skipped;
  records.push(...parsed.records.filter((r) => !run || r.context?.run === run));
}

const result = evaluate(records, thresholds);

if (args.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

writeFileSync(
  out,
  renderHtml(result, {
    generatedAt: new Date().toISOString(),
    source: url ?? files.join(', '),
    run,
  }),
);

console.log(
  `\nrealHuman evaluation · ${result.sessions} sessions · ${result.humans.n} human, ${result.bots.n} bot, ${result.unlabelled} unlabelled${skipped ? ` · ${skipped} invalid lines skipped` : ''}\n`,
);
for (const line of findings(result)) console.log(`• ${line}`);
if (result.scenarios.length) {
  console.log('\nBy scenario:');
  for (const s of result.scenarios) {
    console.log(
      `  ${s.scenario.padEnd(26)} ${String(s.verdicts.bot).padStart(3)}/${s.n} caught · ${s.verdicts.uncertain} uncertain · ${s.verdicts.human} passed as human`,
    );
  }
}
console.log(`\nReport written to ${out}`);
