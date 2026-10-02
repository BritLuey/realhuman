import { describe, expect, it } from 'vitest';
import { buildState } from '../src/index.js';
import { CHROME_JA4, CHROME_UA, humanAnalysis, humanSignals } from './helpers.js';

function keysOf(value: unknown, path = ''): string[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    `${path}${key}`,
    ...keysOf(child, `${path}${key}.`),
  ]);
}

describe('buildState', () => {
  it('includes network facts, JA4 parts, signal summaries and evidence', () => {
    const analysis = humanAnalysis();
    const state = buildState(analysis) as Record<string, Record<string, unknown>>;

    expect(state.network).toEqual({
      uaFamily: 'chrome',
      uaMajor: 141,
      platform: 'windows',
      timezoneMatch: true,
      secFetchPresent: true,
      clientHintsPresent: true,
      clientHintsMismatch: false,
      verifiedAgent: null,
    });
    expect(state.tls).toEqual({
      ja4: {
        transport: 't',
        tlsVersion: 13,
        sni: true,
        cipherCount: 15,
        extensionCount: 16,
        alpn: 'h2',
      },
      assessment: 'browser_like',
    });
    const browser = state.browser as Record<string, unknown>;
    expect(browser.pointer).toEqual(humanSignals().pointer);
    expect(browser.scroll).toEqual(humanSignals().scroll);
    expect(browser.timing).toEqual(humanSignals().timing);
    expect(browser.honeypot).toEqual(humanSignals().honeypot);
    expect(browser.env).toMatchObject({ webdriver: false, maxTouchPoints: 0 });
    expect(state.evidence).toEqual(
      analysis.evidence.map((e) => ({ code: e.code, weight: e.weight })),
    );
    expect(state.neutral).toEqual(analysis.neutral);
    expect(state.privacyBrowser).toBe(false);
  });

  it('never contains IPs, the user agent, the raw JA4 or its hashes, the time zone, join keys or session ids', () => {
    const analysis = humanAnalysis();
    const text = JSON.stringify(buildState(analysis));

    expect(text).not.toContain(CHROME_JA4);
    expect(text).not.toContain('8daaf6152771');
    expect(text).not.toContain('02713d6af862');
    expect(text).not.toContain(CHROME_UA);
    expect(text).not.toContain('Mozilla');
    expect(text).not.toContain('Europe/London');
    expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);

    const keys = keysOf(buildState(analysis)).map((key) => key.split('.').pop()?.toLowerCase());
    for (const forbidden of [
      'ip',
      'ipaddress',
      'useragent',
      'raw',
      'cipherhash',
      'extensionhash',
      'timezone',
      'iptimezone',
      'context',
      'sid',
      'nonce',
      'gaclientid',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('describes a session without JavaScript', () => {
    const state = buildState(humanAnalysis(null)) as Record<string, unknown>;
    expect(state.browser).toBeNull();
    expect(state.neutral).toContain('no_js');
  });
});
