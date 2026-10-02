import { describe, expect, it } from 'vitest';
import {
  analyze,
  assessJa4,
  deriveServerFacts,
  parseJa4,
  parseUserAgent,
  resolveOptions,
  scoreAlgorithmically,
  timezonesMatch,
} from '../src/index.js';
import { issueNonce, verifyNonce } from '../src/nonce.js';
import { loadKeys } from '../src/secrets.js';
import {
  botSignals,
  browserHeaders,
  CHROME_JA4,
  CHROME_UA,
  humanSignals,
  idleSignals,
  OTHER_SECRET,
  SECRET,
  silentLogger,
} from './helpers.js';

const noLists = { browser: [], nonBrowser: [] };

async function keysFor(current: string, previous?: string) {
  const options = resolveOptions({
    env: (name) =>
      name === 'REALHUMAN_SECRET'
        ? current
        : name === 'REALHUMAN_SECRET_PREVIOUS'
          ? previous
          : undefined,
    logger: silentLogger,
    onDecision: () => {},
  });
  const result = await loadKeys(options);
  if (!('keys' in result)) throw new Error(result.problem);
  return result.keys;
}

describe('nonces', () => {
  const binding = { userAgent: CHROME_UA, ja4: CHROME_JA4 };

  it('round-trips', async () => {
    const keys = await keysFor(SECRET);
    const { nonce, expiresAt } = await issueNonce(
      keys,
      'sid_1234567890abcdef',
      binding,
      1000,
      60_000,
    );
    expect(expiresAt).toBe(61_000);
    const verified = await verifyNonce(keys, nonce, binding, 2000);
    expect(verified).toMatchObject({ sid: 'sid_1234567890abcdef', issuedAt: 1000, problem: null });
  });

  it('rejects tampering and other secrets', async () => {
    const keys = await keysFor(SECRET);
    const other = await keysFor(OTHER_SECRET);
    const { nonce } = await issueNonce(keys, 'sid_1234567890abcdef', binding, 1000, 60_000);
    const [v, payload, signature] = nonce.split('.');
    const forged = `${v}.${payload}x.${signature}`;
    expect((await verifyNonce(keys, forged, binding, 2000)).problem).toBe('nonce_invalid');
    expect((await verifyNonce(other, nonce, binding, 2000)).problem).toBe('nonce_invalid');
    expect((await verifyNonce(keys, 'garbage', binding, 2000)).problem).toBe('nonce_invalid');
  });

  it('expires', async () => {
    const keys = await keysFor(SECRET);
    const { nonce } = await issueNonce(keys, 'sid_1234567890abcdef', binding, 1000, 60_000);
    expect((await verifyNonce(keys, nonce, binding, 61_001)).problem).toBe('nonce_expired');
    expect((await verifyNonce(keys, nonce, binding, 61_001, 10_000)).problem).toBeNull();
  });

  it('detects replay from another browser or TLS stack', async () => {
    const keys = await keysFor(SECRET);
    const { nonce } = await issueNonce(keys, 'sid_1234567890abcdef', binding, 1000, 60_000);
    expect(
      (await verifyNonce(keys, nonce, { ...binding, userAgent: 'curl/8.0' }, 2000)).problem,
    ).toBe('nonce_replayed');
    expect(
      (
        await verifyNonce(
          keys,
          nonce,
          { ...binding, ja4: 't13d3112h2_e8f1e7e78f70_6bebaf5329ac' },
          2000,
        )
      ).problem,
    ).toBe('nonce_replayed');
  });

  it('tolerates a switch between HTTP/2 and HTTP/3', async () => {
    const keys = await keysFor(SECRET);
    const { nonce } = await issueNonce(keys, 'sid_1234567890abcdef', binding, 1000, 60_000);
    const quic = { ...binding, ja4: 'q13d0312h3_55b375c5d22e_06cda9e17597' };
    expect((await verifyNonce(keys, nonce, quic, 2000)).problem).toBeNull();
  });

  it('accepts nonces signed with the previous secret during rotation', async () => {
    const old = await keysFor(OTHER_SECRET);
    const { nonce } = await issueNonce(old, 'sid_1234567890abcdef', binding, 1000, 60_000);
    const rotated = await keysFor(SECRET, OTHER_SECRET);
    expect((await verifyNonce(rotated, nonce, binding, 2000)).problem).toBeNull();
  });

  it('refuses short secrets', async () => {
    const options = resolveOptions({
      env: () => 'short',
      logger: silentLogger,
      onDecision: () => {},
    });
    expect(await loadKeys(options)).toEqual({ problem: 'too_short' });
  });
});

describe('parseUserAgent', () => {
  it.each([
    [CHROME_UA, 'chrome', 141, 'windows'],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
      'safari',
      18,
      'macos',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
      'firefox',
      133,
      'linux',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      'edge',
      141,
      'windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
      'chrome',
      141,
      'ios',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Cubot X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      'chrome',
      141,
      'android',
    ],
    ['curl/8.7.1', 'bot', null, 'other'],
    ['python-requests/2.32.3', 'bot', null, 'other'],
    [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'bot',
      null,
      'other',
    ],
  ])('%s', (ua, family, major, platform) => {
    expect(parseUserAgent(ua)).toMatchObject({ family, major, platform });
  });

  it('flags headless Chrome', () => {
    expect(parseUserAgent(CHROME_UA.replace('Chrome/', 'HeadlessChrome/')).headless).toBe(true);
  });
});

describe('JA4', () => {
  it('parses', () => {
    expect(parseJa4(CHROME_JA4)).toMatchObject({
      transport: 't',
      tlsVersion: 13,
      sni: true,
      cipherCount: 15,
      extensionCount: 16,
      alpn: 'h2',
    });
    expect(parseJa4('nonsense')).toBeNull();
  });

  it('assesses against browser claims', () => {
    expect(assessJa4(parseJa4(CHROME_JA4), true, noLists)).toBe('browser_like');
    expect(assessJa4(parseJa4('t13d171500_5b57614c22b0_3d5424432f57'), true, noLists)).toBe(
      'non_browser',
    );
    expect(assessJa4(parseJa4('t12d1209h1_d34a8e72043a_b39be8c56a14'), true, noLists)).toBe(
      'mismatch',
    );
    expect(assessJa4(parseJa4('t13d171500_5b57614c22b0_3d5424432f57'), false, noLists)).toBe(
      'unknown',
    );
    expect(assessJa4(parseJa4(CHROME_JA4), true, { browser: [], nonBrowser: [CHROME_JA4] })).toBe(
      'non_browser',
    );
  });
});

describe('deriveServerFacts', () => {
  it('reduces headers to privacy-safe facts', () => {
    const facts = deriveServerFacts(
      browserHeaders(),
      { ja4: CHROME_JA4, ipTimezone: 'Europe/London' },
      'Europe/London',
      null,
    );
    expect(facts).toEqual({
      ja4: CHROME_JA4,
      uaFamily: 'chrome',
      uaMajor: 141,
      platform: 'windows',
      timezoneMatch: true,
      secFetchPresent: true,
      clientHintsPresent: true,
      clientHintsMismatch: false,
      verifiedAgent: null,
    });
  });

  it('spots Client Hints that contradict the user agent', () => {
    const wrongVersion = browserHeaders({
      'sec-ch-ua': '"Chromium";v="120", "Google Chrome";v="120"',
    });
    expect(
      deriveServerFacts(wrongVersion, { ja4: null, ipTimezone: null }, null, null)
        .clientHintsMismatch,
    ).toBe(true);
    const wrongPlatform = browserHeaders({ 'sec-ch-ua-platform': '"macOS"' });
    expect(
      deriveServerFacts(wrongPlatform, { ja4: null, ipTimezone: null }, null, null)
        .clientHintsMismatch,
    ).toBe(true);
    const firefoxWithHints = browserHeaders({
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
    });
    expect(
      deriveServerFacts(firefoxWithHints, { ja4: null, ipTimezone: null }, null, null)
        .clientHintsMismatch,
    ).toBe(true);
  });

  it('compares time zones by offset', () => {
    const july = new Date('2026-07-01T12:00:00Z');
    expect(timezonesMatch('Europe/London', 'Europe/Dublin', july)).toBe(true);
    expect(timezonesMatch('Europe/London', 'America/New_York', july)).toBe(false);
    expect(timezonesMatch('Not/AZone', 'Europe/London', july)).toBeNull();
    expect(timezonesMatch(null, 'Europe/London', july)).toBeNull();
  });
});

describe('analysis and algorithmic scoring', () => {
  const server = deriveServerFacts(
    browserHeaders(),
    { ja4: CHROME_JA4, ipTimezone: 'Europe/London' },
    'Europe/London',
    null,
  );

  it('scores natural behaviour in a consistent browser as human', () => {
    const analysis = analyze({ signals: humanSignals(), server, ja4Lists: noLists });
    expect(analysis.gates).toEqual([]);
    const result = scoreAlgorithmically(analysis);
    expect(result.realHuman).toBeGreaterThanOrEqual(0.9);
    expect(result.kind).toBe('human');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['pointer_natural', 'keyboard_natural', 'scroll_natural']),
    );
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('scores an automated headless browser as a bot', () => {
    const analysis = analyze({ signals: botSignals(), server, ja4Lists: noLists });
    const result = scoreAlgorithmically(analysis);
    expect(result.realHuman).toBeLessThan(0.05);
    expect(result.kind).toBe('automation');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'webdriver',
        'synthetic_events',
        'headless_markers',
        'pointer_teleport',
      ]),
    );
  });

  it('treats no interaction as low confidence, not as bot evidence', () => {
    const result = scoreAlgorithmically(
      analyze({ signals: idleSignals(), server, ja4Lists: noLists }),
    );
    expect(result.realHuman).toBeGreaterThan(0.5);
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.reasons).toContain('no_interaction');
  });

  it('switches off consistency penalties for privacy browsers', () => {
    const signals = humanSignals();
    const analysis = analyze({
      signals: {
        ...signals,
        env: {
          ...signals.env,
          privacyBrowser: 'brave',
          nativeTamper: true,
          workerMismatch: true,
          softwareRenderer: true,
        },
      },
      server: { ...server, timezoneMatch: false },
      ja4Lists: noLists,
    });
    const codes = analysis.evidence.map((e) => e.code);
    expect(codes).not.toContain('native_tamper');
    expect(codes).not.toContain('worker_mismatch');
    expect(codes).not.toContain('timezone_mismatch');
    const result = scoreAlgorithmically(analysis);
    expect(result.kind).toBe('privacy_browser');
    expect(result.reasons).toContain('privacy_browser');
  });

  it('caps each evidence group', () => {
    const signals = botSignals();
    const analysis = analyze({
      signals: {
        ...signals,
        env: { ...signals.env, nativeTamper: true, workerMismatch: true, featureMismatch: true },
      },
      server,
      ja4Lists: noLists,
    });
    const envTotal = analysis.evidence
      .filter((e) => e.group === 'environment')
      .reduce((sum, e) => sum + e.weight, 0);
    expect(envTotal).toBeLessThan(-6);
    // Capped at -6 for environment + -5 for behaviour + prior 0.4 → sigmoid(-10.6)
    expect(scoreAlgorithmically(analysis).realHuman).toBeCloseTo(0, 3);
  });

  it('gates honeypots, automation markers, declared bots and non-browser TLS', () => {
    const signals = humanSignals();
    const honeypot = signals.honeypot;
    if (!honeypot) throw new Error('fixture');
    expect(
      analyze({
        signals: { ...signals, honeypot: { ...honeypot, filled: 1 } },
        server,
        ja4Lists: noLists,
      }).gates,
    ).toEqual(['honeypot_filled']);
    expect(
      analyze({
        signals: { ...signals, env: { ...signals.env, automationMarkers: ['playwright'] } },
        server,
        ja4Lists: noLists,
      }).gates,
    ).toEqual(['automation_markers']);
    expect(
      analyze({ signals: null, server: { ...server, uaFamily: 'bot' }, ja4Lists: noLists }).gates,
    ).toContain('ua_bot');
    expect(
      analyze({
        signals,
        server: { ...server, ja4: 't13d171500_5b57614c22b0_3d5424432f57' },
        ja4Lists: noLists,
      }).gates,
    ).toEqual(['ja4_non_browser']);
  });

  it('flags missing fetch metadata for modern browsers only', () => {
    const missing = { ...server, secFetchPresent: false };
    expect(
      analyze({ signals: humanSignals(), server: missing, ja4Lists: noLists }).evidence.map(
        (e) => e.code,
      ),
    ).toContain('sec_fetch_missing');
    const old = { ...missing, uaMajor: 70 };
    expect(
      analyze({ signals: humanSignals(), server: old, ja4Lists: noLists }).evidence.map(
        (e) => e.code,
      ),
    ).not.toContain('sec_fetch_missing');
  });
});

describe('resolveOptions', () => {
  it('validates configuration', () => {
    expect(() => resolveOptions({ deliver: 'nowhere' as never })).toThrow(TypeError);
    expect(() => resolveOptions({ thresholds: { human: 0.2, bot: 0.4 } })).toThrow(TypeError);
    expect(() => resolveOptions({ clientFields: ['reasons' as never] })).toThrow(TypeError);
    expect(() => resolveOptions({ nonceTtlMs: -1 })).toThrow(TypeError);
    expect(() => resolveOptions({ engine: 'magic' as never })).toThrow(TypeError);
  });
});

describe('verified agents', () => {
  it('are labelled without calling an external scorer', async () => {
    const { decideWith, vi } = {
      ...(await import('../src/index.js')),
      vi: (await import('vitest')).vi,
    };
    const score = vi.fn();
    const server = deriveServerFacts(
      browserHeaders(),
      { ja4: CHROME_JA4, ipTimezone: null },
      null,
      'agent.example',
    );
    const analysis = analyze({ signals: humanSignals(), server, ja4Lists: noLists });
    const options = resolveOptions({ logger: silentLogger, onDecision: () => {} });
    const decision = await decideWith({ name: 'jev', score }, analysis, options);
    expect(score).not.toHaveBeenCalled();
    expect(decision).toMatchObject({
      verdict: 'verified_agent',
      kind: 'verified_agent',
      engine: 'algorithmic',
    });
    expect(decision.reasons).toContain('verified_agent_signature');
  });
});

describe('embedded browsers', () => {
  const server = deriveServerFacts(
    browserHeaders(),
    { ja4: CHROME_JA4, ipTimezone: null },
    null,
    null,
  );
  const withZeroOuter = () => {
    const signals = idleSignals();
    return { ...signals, env: { ...signals.env, headlessMarkers: ['zero_outer_size' as const] } };
  };

  it('treat a zero outer window size as weak evidence on desktop', () => {
    const result = scoreAlgorithmically(
      analyze({ signals: withZeroOuter(), server, ja4Lists: noLists }),
    );
    // Uncertain at worst, never pushed towards bot by this marker alone.
    expect(result.realHuman).toBeGreaterThan(0.45);
  });

  it('ignore a zero outer window size on mobile', () => {
    const analysis = analyze({
      signals: withZeroOuter(),
      server: { ...server, platform: 'ios' },
      ja4Lists: noLists,
    });
    expect(analysis.evidence.map((e) => e.code)).not.toContain('headless_markers');
  });
});

describe('click patterns', () => {
  it('need at least 3 clicks before they count', () => {
    const server = deriveServerFacts(
      browserHeaders(),
      { ja4: CHROME_JA4, ipTimezone: null },
      null,
      null,
    );
    const signals = humanSignals();
    const pointer = signals.pointer;
    if (!pointer) throw new Error('fixture');
    const twoClicks = {
      ...signals,
      pointer: { ...pointer, clicks: 2, teleportClicks: 2, centerClicks: 2 },
    };
    const codes = analyze({ signals: twoClicks, server, ja4Lists: noLists }).evidence.map(
      (e) => e.code,
    );
    expect(codes).not.toContain('pointer_teleport');
    expect(codes).not.toContain('click_dead_center');
  });
});
