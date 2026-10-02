// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { init } from '../src/index.js';

describe('server-side rendering', () => {
  it('returns an inert instance when there is no window', async () => {
    expect(typeof window).toBe('undefined');
    const rh = init({ debug: true });
    expect(rh.sid).toBe('');
    await expect(rh.ready).resolves.toBeNull();
    await expect(rh.score()).resolves.toBeNull();
    expect(() => {
      rh.on('result', () => {});
      rh.off('result', () => {});
      rh.grantConsent();
      rh.destroy();
    }).not.toThrow();
  });
});
