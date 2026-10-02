// Builds dist/realhuman.iife.js and enforces the gzipped size budgets.
// Run after `tsc -p tsconfig.build.json` (see the package's build script).
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const CORE_BUDGET = 8192;
const INTEGRATION_BUDGET = 1024;
const INTEGRATIONS = ['new-relic', 'datadog-rum', 'ga4', 'data-layer', 'segment', 'posthog'];

const shared = {
  bundle: true,
  minify: true,
  target: 'es2020',
  platform: 'browser',
  logLevel: 'warning',
};

await build({
  ...shared,
  entryPoints: ['src/iife.ts'],
  format: 'iife',
  outfile: 'dist/realhuman.iife.js',
});

async function gzippedSize(entry, format = 'esm') {
  const result = await build({ ...shared, entryPoints: [entry], format, write: false });
  const output = result.outputFiles[0];
  return { raw: output.contents.length, gzip: gzipSync(output.contents, { level: 9 }).length };
}

const rows = [
  ['core (index.ts, esm)', await gzippedSize('src/index.ts'), CORE_BUDGET],
  ['script tag (iife.ts)', await gzippedSize('src/iife.ts', 'iife'), null],
  ...(await Promise.all(
    INTEGRATIONS.map(async (name) => [
      `integrations/${name}`,
      await gzippedSize(`src/integrations/${name}.ts`),
      INTEGRATION_BUDGET,
    ]),
  )),
];

let failed = false;
console.log('bundle                        minified   gzipped    budget');
for (const [name, size, budget] of rows) {
  const over = budget !== null && size.gzip > budget;
  failed ||= over;
  console.log(
    `${name.padEnd(30)}${String(size.raw).padStart(8)} B${String(size.gzip).padStart(8)} B${
      budget === null ? '' : `${String(budget).padStart(8)} B${over ? '  OVER BUDGET' : ''}`
    }`,
  );
}
if (failed) {
  console.error('Bundle size budget exceeded.');
  process.exit(1);
}
