#!/usr/bin/env node
// Re-scores decision records (NDJSON, one record per line) with the installed engine, so stored
// sessions get the latest labels, evidence levels and scores.
//
//   realhuman-rescore < records.ndjson > rescored.ndjson
//
// Invalid lines are reported on stderr and skipped.
import { createInterface } from 'node:readline';
import { parseDecisionRecord } from '@realhuman/schema';
import { rescore, VERSION } from '../dist/index.js';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: realhuman-rescore < in.ndjson > out.ndjson\n' +
      `Re-scores realHuman decision records with engine ${VERSION}.\n`,
  );
  process.exit(0);
}

const silent = { debug() {}, info() {}, warn() {}, error: (...a) => console.error(...a) };
let line = 0;
let rescored = 0;
let skipped = 0;

for await (const text of createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
})) {
  line++;
  if (!text.trim()) continue;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    process.stderr.write(`line ${line}: not valid JSON, skipped\n`);
    skipped++;
    continue;
  }
  const parsed = parseDecisionRecord(json);
  if (!parsed.success) {
    process.stderr.write(`line ${line}: ${parsed.issues[0]}, skipped\n`);
    skipped++;
    continue;
  }
  const record = await rescore(parsed.output, { logger: silent });
  process.stdout.write(`${JSON.stringify(record)}\n`);
  rescored++;
}

process.stderr.write(`realhuman-rescore: ${rescored} re-scored, ${skipped} skipped\n`);
