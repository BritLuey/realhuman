import { describe, expect, it } from 'vitest';
import {
  analyze,
  botEvidenceLevel,
  deriveServerFacts,
  humanEvidenceLevel,
  labelFor,
  primaryReason,
  scoreAlgorithmically,
} from '../src/index.js';
import { botSignals, browserHeaders, CHROME_JA4, humanSignals, idleSignals } from './helpers.js';

const noLists = { browser: [], nonBrowser: [] };
const server = deriveServerFacts(
  browserHeaders(),
  { ja4: CHROME_JA4, ipTimezone: null },
  null,
  null,
);

function describeSession(signals = idleSignals(), overrides = {}) {
  const analysis = analyze({ signals, server: { ...server, ...overrides }, ja4Lists: noLists });
  const bot = botEvidenceLevel(analysis);
  const human = humanEvidenceLevel(analysis);
  const label = labelFor(bot, human, false);
  return {
    bot,
    human,
    label,
    primary: primaryReason(analysis, label),
    score: scoreAlgorithmically(analysis).realHuman,
  };
}

describe('label matrix', () => {
  it.each([
    ['none', 'none', 'unverified'],
    ['weak', 'none', 'unverified'],
    ['none', 'some', 'human'],
    ['weak', 'strong', 'human'],
    ['moderate', 'none', 'suspicious'],
    ['moderate', 'strong', 'suspicious'],
    ['strong', 'strong', 'bot'],
    ['conclusive', 'none', 'bot'],
  ] as const)('bot %s + human %s → %s', (bot, human, label) => {
    expect(labelFor(bot, human, false)).toBe(label);
  });

  it('verified agents win', () => {
    expect(labelFor('strong', 'none', true)).toBe('verified_agent');
  });
});

describe('real-world cases', () => {
  it('a page load with no interaction is unverified, not uncertain-looking', () => {
    expect(describeSession()).toMatchObject({
      bot: 'none',
      human: 'none',
      label: 'unverified',
      primary: 'no_interaction',
      score: 0.599,
    });
  });

  it('a VPN visitor who bounced is still unverified (weak evidence only)', () => {
    expect(describeSession(idleSignals(), { timezoneMatch: false })).toMatchObject({
      bot: 'weak',
      label: 'unverified',
    });
  });

  it('a Citrix/VDI visitor with software graphics is suspicious, not bot', () => {
    const signals = idleSignals();
    expect(
      describeSession({ ...signals, env: { ...signals.env, softwareRenderer: true } }),
    ).toMatchObject({
      bot: 'moderate',
      label: 'suspicious',
      primary: 'software_renderer',
    });
  });

  it('natural mouse and typing is human with strong evidence', () => {
    expect(describeSession(humanSignals())).toMatchObject({
      human: 'strong',
      label: 'human',
      primary: 'pointer_natural',
    });
  });

  it('an automated browser is a bot with strong evidence', () => {
    expect(describeSession(botSignals())).toMatchObject({
      bot: 'strong',
      label: 'bot',
      primary: 'webdriver',
    });
  });

  it('webdriver alone is strong enough for bot', () => {
    const signals = idleSignals();
    expect(describeSession({ ...signals, env: { ...signals.env, webdriver: true } }).label).toBe(
      'bot',
    );
  });
});

describe('headless markers', () => {
  it('a desktop window with no browser UI is suspicious on its own, even with natural movement', () => {
    const signals = humanSignals();
    expect(
      describeSession({ ...signals, env: { ...signals.env, headlessMarkers: ['no_browser_ui'] } }),
    ).toMatchObject({ bot: 'moderate', label: 'suspicious', primary: 'headless_markers' });
  });
});
