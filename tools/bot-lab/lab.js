// realHuman bot lab: runs common automation stacks against the demo site and reports how each
// one is scored. Uses an installed Chrome or Edge through playwright-core (no browser download).
//
//   pnpm --filter @realhuman/bot-lab lab                 # all scenarios
//   pnpm --filter @realhuman/bot-lab lab -- --only=http  # scenarios whose name contains "http"
//   BOT_LAB_BROWSER=msedge pnpm --filter @realhuman/bot-lab lab
//
// Locally there's no CDN, so JA4 is only present when a scenario sends it explicitly (the demo is
// started with DEMO_TRUST_JA4_HEADER=x-ja4 so scenarios can simulate what a CDN would add).
//
// What this lab can't do: measure false positives. That needs real human sessions, which can't be
// automated. Run the demo yourself (pnpm --filter @realhuman/demo start) to check human scores.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const demoServer = join(dirname(require.resolve('@realhuman/demo/package.json')), 'server.js');
const PORT = Number(process.env.BOT_LAB_PORT ?? 3917);
const BASE = `http://localhost:${PORT}`;
const CHANNEL = process.env.BOT_LAB_BROWSER ?? 'chrome';
const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const CHROME_JA4 = 't13d1516h2_8daaf6152771_02713d6af862';
const PYTHON_JA4 = 't13d1312h1_2b729b4bf6f3_1a2f2d4b7c9e';

// ── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/decisions`)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('demo server did not start');
}

async function latestDecision(sid, { minSeq = 0, timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [record] = await (await fetch(`${BASE}/decisions?sid=${encodeURIComponent(sid)}`)).json();
    if (record && record.seq >= minSeq) return record;
    await sleep(100);
  }
  return null;
}

/** A plausible-looking "human" payload, as a scraper that copied one might send. */
function forgedHumanSignals() {
  return {
    env: {
      webdriver: false,
      automationMarkers: [],
      headlessMarkers: [],
      softwareRenderer: false,
      uaClientHintsMismatch: false,
      workerMismatch: false,
      featureMismatch: false,
      nativeTamper: false,
      privacyBrowser: null,
      timezone: 'Europe/London',
      maxTouchPoints: 0,
    },
    pointer: {
      events: 80,
      trustedRatio: 1,
      coalescedPerMove: 2,
      speedMean: 0.6,
      speedCv: 0.8,
      accelerationCv: 1.8,
      curvatureMean: 0.2,
      straightRatio: 0.1,
      pauses: 3,
      clicks: 1,
      teleportClicks: 0,
      centerClicks: 0,
      pointerTypes: { mouse: 80, pen: 0, touch: 0 },
      pressureVariance: null,
    },
    keyboard: null,
    touch: null,
    scroll: null,
    timing: {
      firstInteractionMs: 400,
      rafJitterMs: 1,
      eventLoopLagMs: 2,
      clockDriftMs: 0,
      visibilityChanges: 0,
      focusChanges: 0,
      domContentLoadedMs: 200,
    },
    honeypot: null,
  };
}

async function httpScenario({ initHeaders, scoreHeaders = initHeaders }) {
  const init = await (await fetch(`${BASE}/api/realhuman/init`, { headers: initHeaders })).json();
  await sleep(1000);
  await fetch(`${BASE}/api/realhuman/score`, {
    method: 'POST',
    headers: { ...scoreHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      v: 1,
      sid: init.sid,
      nonce: init.nonce,
      seq: 0,
      final: false,
      elapsedMs: 1100,
      wallElapsedMs: 1100,
      nonceAgeMs: 1000,
      context: {},
      signals: forgedHumanSignals(),
    }),
  });
  return latestDecision(init.sid);
}

let browser;
async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      channel: CHANNEL,
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
  }
  return browser;
}

async function browserScenario({ userAgent, init: initScript, act, extraHeaders }) {
  const context = await (await getBrowser()).newContext({
    ...(userAgent && { userAgent }),
    ...(extraHeaders && { extraHTTPHeaders: extraHeaders }),
  });
  try {
    const page = await context.newPage();
    if (initScript) await page.addInitScript(initScript);
    await page.goto(BASE);
    await page.waitForFunction(() => window.realHuman?.sid, null, { timeout: 5000 });
    await act(page);
    const sid = await page.evaluate(() => window.realHuman.sid);
    const seq = await page.evaluate(async () => (await window.realHuman.score())?.seq ?? 0);
    return latestDecision(sid, { minSeq: seq });
  } finally {
    await context.close();
  }
}

async function straightMouse(page) {
  await page.mouse.move(10, 10);
  await page.mouse.move(600, 400, { steps: 40 });
  await page.click('#score-now');
}

// ── Scenarios ───────────────────────────────────────────────────────────────

const scenarios = [
  {
    name: 'http: python-requests (honest UA, non-browser TLS)',
    run: () =>
      httpScenario({
        initHeaders: { 'user-agent': 'python-requests/2.32.3', 'x-ja4': PYTHON_JA4 },
      }),
  },
  {
    name: 'http: scraper posing as Chrome (forged human payload, no fetch metadata)',
    run: () =>
      httpScenario({
        initHeaders: { 'user-agent': CHROME_UA, 'x-ja4': 't13d1312h1_2b729b4bf6f3_1a2f2d4b7c9e' },
      }),
  },
  {
    name: 'http: replayed nonce (issued to Chrome, used by another client)',
    run: () =>
      httpScenario({
        initHeaders: {
          'user-agent': CHROME_UA,
          'x-ja4': CHROME_JA4,
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'cors',
        },
        scoreHeaders: {
          'user-agent': `${CHROME_UA} Replayer`,
          'x-ja4': CHROME_JA4,
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'cors',
        },
      }),
  },
  {
    name: 'browser: headless, scripted straight-line mouse',
    run: () => browserScenario({ act: straightMouse }),
  },
  {
    name: 'browser: headless, navigator.webdriver left on',
    run: () =>
      browserScenario({
        init: () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => true }),
        act: straightMouse,
      }),
  },
  {
    name: 'browser: synthetic events dispatched from script',
    run: () =>
      browserScenario({
        act: async (page) => {
          await page.evaluate(() => {
            for (let i = 0; i < 30; i++) {
              window.dispatchEvent(
                new PointerEvent('pointermove', { clientX: i * 10, clientY: i * 5, bubbles: true }),
              );
            }
            document.querySelector('#score-now').click();
          });
          await page.waitForTimeout(300);
        },
      }),
  },
  {
    name: 'browser: form filler that completes every field',
    run: () =>
      browserScenario({
        act: async (page) => {
          await page.evaluate(() => {
            for (const input of document.querySelectorAll('form input, form textarea'))
              input.value = 'test';
          });
          await page.evaluate(() => document.querySelector('#signup').requestSubmit());
          await page.waitForTimeout(300);
        },
      }),
  },
  {
    name: 'browser: spoofed user agent patched in JavaScript (stealth-style)',
    run: () =>
      browserScenario({
        userAgent: CHROME_UA,
        init: () => {
          Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        },
        act: straightMouse,
      }),
  },
  {
    name: 'browser: Playwright leftovers in the page (__playwright* globals)',
    run: () =>
      browserScenario({
        init: () => {
          window.__playwright__binding__ = () => {};
        },
        act: straightMouse,
      }),
  },
];

// ── Run ─────────────────────────────────────────────────────────────────────

const demo = spawn(process.execPath, [demoServer], {
  env: { ...process.env, PORT: String(PORT), DEMO_TRUST_JA4_HEADER: 'x-ja4' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const results = [];
try {
  await waitForServer();
  for (const scenario of scenarios) {
    if (only && !scenario.name.includes(only)) continue;
    process.stdout.write(`• ${scenario.name} … `);
    try {
      const record = await scenario.run();
      if (!record) {
        results.push({ scenario: scenario.name, error: 'no decision recorded' });
        console.log('no decision recorded');
        continue;
      }
      results.push({
        scenario: scenario.name,
        realHuman: record.realHuman,
        verdict: record.verdict,
        kind: record.kind,
        engine: record.engine,
        reasons: record.reasons,
        signals: record.signals,
        server: record.server,
      });
      console.log(`${record.verdict} (${record.realHuman}) ${record.reasons.join(', ')}`);
    } catch (error) {
      results.push({ scenario: scenario.name, error: String(error?.message ?? error) });
      console.log(`error: ${error?.message ?? error}`);
    }
  }
} finally {
  await browser?.close().catch(() => {});
  demo.kill();
}

const scored = results.filter((r) => r.verdict);
const caught = scored.filter((r) => r.verdict === 'bot').length;
console.log(
  `\n${caught}/${scored.length} automated scenarios scored as bot (browser: ${CHANNEL}).`,
);

mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(
  join(here, 'results', 'latest.json'),
  `${JSON.stringify({ ranAt: new Date().toISOString(), browser: CHANNEL, results }, null, 2)}\n`,
);
