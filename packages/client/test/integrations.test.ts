import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealHumanInstance } from '../src/index.js';
import { dataLayer } from '../src/integrations/data-layer.js';
import { datadogRum } from '../src/integrations/datadog-rum.js';
import { ga4 } from '../src/integrations/ga4.js';
import { newRelic } from '../src/integrations/new-relic.js';
import { posthog } from '../src/integrations/posthog.js';
import { segment } from '../src/integrations/segment.js';
import { result, SID } from './helpers.js';

const instance = {} as RealHumanInstance;
const r = result(0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('integrations', () => {
  it('New Relic sets persisted attributes and a page action', () => {
    const nr = { setCustomAttribute: vi.fn(), addPageAction: vi.fn() };
    vi.stubGlobal('newrelic', nr);
    newRelic().onResult(r, instance);
    expect(nr.setCustomAttribute).toHaveBeenCalledWith('realHuman', 0.92, true);
    expect(nr.setCustomAttribute).toHaveBeenCalledWith('realHumanVerdict', 'human', true);
    expect(nr.setCustomAttribute).toHaveBeenCalledWith('realHumanSid', SID, true);
    expect(nr.addPageAction).toHaveBeenCalledWith('bot_verdict', {
      realHuman: 0.92,
      verdict: 'human',
      sid: SID,
    });
  });

  it('Datadog RUM sets global context and adds an action', () => {
    const rum = { setGlobalContextProperty: vi.fn(), addAction: vi.fn() };
    vi.stubGlobal('DD_RUM', rum);
    datadogRum().onResult(r, instance);
    expect(rum.setGlobalContextProperty).toHaveBeenCalledWith('realhuman', {
      score: 0.92,
      verdict: 'human',
      sid: SID,
    });
    expect(rum.addAction).toHaveBeenCalledWith(
      'bot_verdict',
      expect.objectContaining({ sid: SID }),
    );
  });

  it('GA4 sends a bot_verdict event', () => {
    const gtag = vi.fn();
    vi.stubGlobal('gtag', gtag);
    ga4().onResult(r, instance);
    expect(gtag).toHaveBeenCalledWith('event', 'bot_verdict', {
      real_human: 0.92,
      verdict: 'human',
      rh_sid: SID,
    });
  });

  it('dataLayer pushes, creating the array if needed', () => {
    vi.stubGlobal('dataLayer', undefined);
    dataLayer().onResult(r, instance);
    expect((globalThis as unknown as { dataLayer: unknown[] }).dataLayer).toEqual([
      { event: 'realhuman_result', realHuman: 0.92, verdict: 'human', sid: SID },
    ]);
  });

  it('Segment tracks Bot Verdict', () => {
    const analytics = { track: vi.fn() };
    vi.stubGlobal('analytics', analytics);
    segment().onResult(r, instance);
    expect(analytics.track).toHaveBeenCalledWith('Bot Verdict', {
      realHuman: 0.92,
      verdict: 'human',
      sid: SID,
    });
  });

  it('PostHog captures an event and registers a super property', () => {
    const ph = { capture: vi.fn(), register: vi.fn() };
    vi.stubGlobal('posthog', ph);
    posthog().onResult(r, instance);
    expect(ph.register).toHaveBeenCalledWith({ real_human: 0.92 });
    expect(ph.capture).toHaveBeenCalledWith('bot_verdict', {
      real_human: 0.92,
      verdict: 'human',
      rh_sid: SID,
    });
  });

  it('waits for a tool that loads later', () => {
    const gtag = vi.fn();
    ga4().onResult(r, instance);
    vi.advanceTimersByTime(1000);
    vi.stubGlobal('gtag', gtag);
    vi.advanceTimersByTime(250);
    expect(gtag).toHaveBeenCalledOnce();
  });

  it('gives up silently after 10 seconds', () => {
    newRelic().onResult(r, instance);
    vi.advanceTimersByTime(10_000);
    expect(vi.getTimerCount()).toBe(0);
    const nr = { setCustomAttribute: vi.fn(), addPageAction: vi.fn() };
    vi.stubGlobal('newrelic', nr);
    vi.advanceTimersByTime(1000);
    expect(nr.setCustomAttribute).not.toHaveBeenCalled();
  });

  it('never throws, even when the tool does', () => {
    vi.stubGlobal('posthog', {
      capture: () => {
        throw new Error('broken');
      },
      register: () => {},
    });
    vi.stubGlobal('analytics', { track: 'not a function' });
    expect(() => posthog().onResult(r, instance)).not.toThrow();
    expect(() => segment().onResult(r, instance)).not.toThrow();
  });

  it('each has a name', () => {
    expect(
      [newRelic(), datadogRum(), ga4(), dataLayer(), segment(), posthog()].map((i) => i.name),
    ).toEqual(['new-relic', 'datadog-rum', 'ga4', 'data-layer', 'segment', 'posthog']);
  });
});
