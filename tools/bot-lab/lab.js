// realHuman bot lab: runs automation techniques against a realHuman demo and reports how each one
// is scored. Uses an installed Chrome or Edge through playwright-core (no browser download).
//
//   pnpm --filter @realhuman/bot-lab lab                          # local demo, started for you
//   pnpm --filter @realhuman/bot-lab lab -- --target=https://your-demo.vercel.app --repeat=10
//   pnpm --filter @realhuman/bot-lab lab -- --only=browser        # scenarios whose name contains "browser"
//   BOT_LAB_BROWSER=msedge pnpm --filter @realhuman/bot-lab lab
//
// Every session is labelled `label=bot`, `scenario=<slug>` and `run=<run id>` in its decision record's
// context, so the evaluation tool (tools/eval) can combine these runs with labelled human sessions.
//
// Locally there's no CDN, so scenarios simulate the JA4 header a CDN would add. Against a deployed
// Vercel demo, the real JA4 of each client is used.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const TARGET = arg('target')?.replace(/\/+$/, '');
const RUN = arg('run') ?? `lab-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
const REPEAT = Math.max(1, Number(arg('repeat') ?? 1));
const ONLY = arg('only');
const CHANNEL = process.env.BOT_LAB_BROWSER ?? 'chrome';
const PORT = Number(process.env.BOT_LAB_PORT ?? 3917);
const BASE = TARGET ?? `http://localhost:${PORT}`;
const REMOTE = Boolean(TARGET);

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const CHROME_JA4 = 't13d1516h2_8daaf6152771_02713d6af862';
const PYTHON_JA4 = 't13d1312h1_2b729b4bf6f3_1a2f2d4b7c9e';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rand = (min, max) => min + Math.random() * (max - min);

// ── Talking to the demo ─────────────────────────────────────────────────────

/** Local demo: GET /decisions?sid=… → list. Vercel demo: GET /api/decisions?sid=… → record. */
async function fetchDecision(sid) {
  const url = REMOTE
    ? `${BASE}/api/decisions?sid=${encodeURIComponent(sid)}`
    : `${BASE}/decisions?sid=${encodeURIComponent(sid)}`;
  const response = await fetch(url);
  if (response.status === 501) return 'no_store';
  if (!response.ok) return null;
  const body = await response.json();
  return Array.isArray(body) ? (body[0] ?? null) : body;
}

async function latestDecision(sid, { minSeq = 0, timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await fetchDecision(sid);
    if (record === 'no_store') return 'no_store';
    if (record && record.seq >= minSeq) return record;
    await sleep(200);
  }
  return null;
}

function pageUrl(slug) {
  return `${BASE}/?label=bot&scenario=${encodeURIComponent(slug)}&run=${encodeURIComponent(RUN)}`;
}

/** Headers a CDN would add. Only meaningful locally; a real CDN overwrites them. */
const ja4 = (value) => (REMOTE ? {} : { 'x-ja4': value });

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

async function httpScenario(slug, { initHeaders, scoreHeaders = initHeaders }) {
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
      context: { label: 'bot', scenario: slug, run: RUN },
      signals: forgedHumanSignals(),
    }),
  });
  return latestDecision(init.sid);
}

let browser;
async function getBrowser() {
  browser ??= await chromium.launch({
    channel: CHANNEL,
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  return browser;
}

async function browserScenario(slug, { userAgent, init: initScript, act, extraHeaders }) {
  const context = await (await getBrowser()).newContext({
    ...(userAgent && { userAgent }),
    ...(extraHeaders && { extraHTTPHeaders: extraHeaders }),
  });
  try {
    const page = await context.newPage();
    if (initScript) await page.addInitScript(initScript);
    await page.goto(pageUrl(slug));
    await page.waitForFunction(() => window.realHuman?.sid, null, { timeout: 10_000 });
    await act(page);
    const sid = await page.evaluate(() => window.realHuman.sid);
    const seq = await page.evaluate(async () => (await window.realHuman.score())?.seq ?? 0);
    return latestDecision(sid, { minSeq: seq });
  } finally {
    await context.close();
  }
}

// ── Movement helpers ────────────────────────────────────────────────────────

async function straightMouse(page) {
  await page.mouse.move(10, 10);
  await page.mouse.move(600, 400, { steps: 40 });
  await page.click('#score-now');
}

/** Curved, jittery, variable-speed movement with pauses, like ghost-cursor and similar libraries. */
async function humanlikeMove(page, from, to) {
  const control = {
    x: (from.x + to.x) / 2 + rand(-150, 150),
    y: (from.y + to.y) / 2 + rand(-120, 120),
  };
  const steps = Math.round(rand(25, 45));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const x = (1 - eased) ** 2 * from.x + 2 * (1 - eased) * eased * control.x + eased ** 2 * to.x;
    const y = (1 - eased) ** 2 * from.y + 2 * (1 - eased) * eased * control.y + eased ** 2 * to.y;
    await page.mouse.move(x + rand(-1.5, 1.5), y + rand(-1.5, 1.5));
    await sleep(rand(4, 22));
    if (Math.random() < 0.04) await sleep(rand(150, 400));
  }
}

async function humanlikeSession(page) {
  let at = { x: rand(50, 200), y: rand(50, 150) };
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 3; i++) {
    const next = { x: rand(80, 700), y: rand(80, 400) };
    await humanlikeMove(page, at, next);
    at = next;
    await sleep(rand(200, 600));
  }
  await page.mouse.wheel(0, rand(150, 300));
  await sleep(rand(300, 700));
  await page.mouse.wheel(0, -rand(100, 200));
  const field = await page.locator('#name').boundingBox();
  if (field) {
    const target = {
      x: field.x + rand(10, field.width - 10),
      y: field.y + rand(5, field.height - 5),
    };
    await humanlikeMove(page, at, target);
    await page.mouse.click(target.x, target.y, { delay: rand(60, 140) });
    at = target;
    for (const ch of 'Jamie Rivera') {
      await page.keyboard.press(ch === ' ' ? 'Space' : ch, { delay: rand(50, 130) });
      await sleep(rand(40, 220));
    }
  }
  const button = await page.locator('#score-now').boundingBox();
  if (button) {
    const target = {
      x: button.x + rand(6, button.width - 6),
      y: button.y + rand(4, button.height - 4),
    };
    await humanlikeMove(page, at, target);
    await page.mouse.click(target.x, target.y, { delay: rand(60, 140) });
  }
  await sleep(500);
}

// ── Scenarios ───────────────────────────────────────────────────────────────

const scenarios = [
  {
    slug: 'http-python-requests',
    name: 'http: python-requests (honest UA, non-browser TLS)',
    run: (slug) =>
      httpScenario(slug, {
        initHeaders: { 'user-agent': 'python-requests/2.32.3', ...ja4(PYTHON_JA4) },
      }),
  },
  {
    slug: 'http-chrome-impostor',
    name: 'http: scraper posing as Chrome (forged human payload, no fetch metadata)',
    run: (slug) =>
      httpScenario(slug, { initHeaders: { 'user-agent': CHROME_UA, ...ja4(PYTHON_JA4) } }),
  },
  {
    slug: 'http-replayed-nonce',
    name: 'http: replayed nonce (issued to one client, used by another)',
    run: (slug) => {
      const base = {
        ...ja4(CHROME_JA4),
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
      };
      return httpScenario(slug, {
        initHeaders: { ...base, 'user-agent': CHROME_UA },
        scoreHeaders: { ...base, 'user-agent': `${CHROME_UA} Replayer` },
      });
    },
  },
  {
    slug: 'headless-straight-mouse',
    name: 'browser: headless, scripted straight-line mouse',
    run: (slug) => browserScenario(slug, { act: straightMouse }),
  },
  {
    slug: 'headless-webdriver',
    name: 'browser: headless, navigator.webdriver left on',
    run: (slug) =>
      browserScenario(slug, {
        init: () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => true }),
        act: straightMouse,
      }),
  },
  {
    slug: 'synthetic-events',
    name: 'browser: synthetic events dispatched from script',
    run: (slug) =>
      browserScenario(slug, {
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
    slug: 'form-filler',
    name: 'browser: form filler that completes every field',
    run: (slug) =>
      browserScenario(slug, {
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
    slug: 'stealth-patches',
    name: 'browser: spoofed user agent patched in JavaScript (stealth-style)',
    run: (slug) =>
      browserScenario(slug, {
        userAgent: CHROME_UA,
        init: () => {
          Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        },
        act: straightMouse,
      }),
  },
  {
    slug: 'playwright-leftovers',
    name: 'browser: Playwright leftovers in the page (__playwright* globals)',
    run: (slug) =>
      browserScenario(slug, {
        init: () => {
          window.__playwright__binding__ = () => {};
        },
        act: straightMouse,
      }),
  },
  {
    slug: 'humanlike-headless',
    name: 'browser: human-like mouse and typing, headless user agent',
    run: (slug) => browserScenario(slug, { act: humanlikeSession }),
  },
  {
    slug: 'humanlike-advanced',
    name: 'browser: human-like mouse and typing, headless markers hidden (advanced)',
    run: async (slug) => {
      const version = (await getBrowser()).version().split('.')[0];
      return browserScenario(slug, {
        // A consistent, non-headless user agent: the kind of setup a determined scraper uses.
        userAgent: CHROME_UA.replace('141.0.0.0', `${version}.0.0.0`),
        act: humanlikeSession,
      });
    },
  },
];

// ── Run ─────────────────────────────────────────────────────────────────────

let demo;
if (!REMOTE) {
  const demoServer = join(dirname(require.resolve('@realhuman/demo/package.json')), 'server.js');
  demo = spawn(process.execPath, [demoServer], {
    env: { ...process.env, PORT: String(PORT), DEMO_TRUST_JA4_HEADER: 'x-ja4' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/decisions`)).ok) break;
    } catch {}
    await sleep(100);
  }
}

console.log(
  `realHuman bot lab · target ${BASE} · run ${RUN} · browser ${CHANNEL} · repeat ${REPEAT}\n`,
);
const results = [];
try {
  for (const scenario of scenarios) {
    if (ONLY && !scenario.name.includes(ONLY) && !scenario.slug.includes(ONLY)) continue;
    for (let i = 0; i < REPEAT; i++) {
      process.stdout.write(`• ${scenario.name}${REPEAT > 1 ? ` [${i + 1}/${REPEAT}]` : ''} … `);
      try {
        const record = await scenario.run(scenario.slug);
        if (record === 'no_store') {
          results.push({ scenario: scenario.slug, stored: true });
          console.log('sent (the demo has no store to read back from; use the export)');
        } else if (!record) {
          results.push({ scenario: scenario.slug, error: 'no decision recorded' });
          console.log('no decision recorded');
        } else {
          results.push({
            scenario: scenario.slug,
            realHuman: record.realHuman,
            verdict: record.verdict,
            kind: record.kind,
            engine: record.engine,
            reasons: record.reasons,
            ja4: record.server.ja4,
            signals: record.signals,
          });
          console.log(`${record.verdict} (${record.realHuman}) ${record.reasons.join(', ')}`);
        }
      } catch (error) {
        results.push({ scenario: scenario.slug, error: String(error?.message ?? error) });
        console.log(`error: ${error?.message ?? error}`);
      }
    }
  }
} finally {
  await browser?.close().catch(() => {});
  if (demo) {
    // Keep the labelled records for the evaluation tool before the local demo shuts down.
    try {
      const text = await (await fetch(`${BASE}/export?run=${encodeURIComponent(RUN)}`)).text();
      mkdirSync(join(here, 'results'), { recursive: true });
      writeFileSync(join(here, 'results', `${RUN}.ndjson`), text);
      console.log(`\nLabelled records saved to tools/bot-lab/results/${RUN}.ndjson`);
    } catch (error) {
      console.log(`\nCould not export records: ${error?.message ?? error}`);
    }
  }
  demo?.kill();
}

const scored = results.filter((r) => r.verdict);
const caught = scored.filter((r) => r.verdict === 'bot').length;
const missed = scored.filter((r) => r.verdict === 'human').length;
console.log(
  `\n${caught}/${scored.length} sessions scored as bot, ${scored.length - caught - missed} uncertain, ${missed} as human.`,
);

mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(
  join(here, 'results', `${RUN}.json`),
  `${JSON.stringify({ ranAt: new Date().toISOString(), target: BASE, run: RUN, browser: CHANNEL, results }, null, 2)}\n`,
);
