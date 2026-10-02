import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServer } from './helpers.js';

afterEach(() => {
  window.realHuman?.destroy();
  Reflect.deleteProperty(window, 'realHuman');
  vi.unstubAllGlobals();
  vi.resetModules();
});

const script = (attrs: Record<string, string>) => {
  const el = document.createElement('script');
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
};

describe('script tag build', () => {
  it('maps data attributes to options', async () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    const { optionsFromScript } = await import('../src/iife.js');
    expect(
      optionsFromScript(
        script({
          'data-endpoint': '/rh',
          'data-flush-after-ms': '2500',
          'data-consent': 'false',
          'data-aws-content-hash': 'true',
          'data-debug': 'true',
        }),
      ),
    ).toEqual({
      endpoint: '/rh',
      flushAfterMs: 2500,
      consent: false,
      awsContentHash: true,
      debug: true,
    });
    expect(optionsFromScript(script({ 'data-flush-after-ms': 'soon' }))).toEqual({});
    expect(optionsFromScript(null)).toEqual({});
  });

  it('starts itself and exposes window.realHuman', async () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    await import('../src/iife.js');
    expect(window.realHuman).toBeDefined();
    expect(typeof window.realHuman?.score).toBe('function');
  });
});
