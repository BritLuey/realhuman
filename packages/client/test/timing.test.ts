import { describe, expect, it } from 'vitest';
import { timingStats } from '../src/signals/timing.js';

describe('timingStats', () => {
  it('is empty before anything happens', () => {
    expect(timingStats(1000).summary(0, 0, null)).toEqual({
      firstInteractionMs: null,
      rafJitterMs: 0,
      eventLoopLagMs: 0,
      clockDriftMs: 0,
      visibilityChanges: 0,
      focusChanges: 0,
      domContentLoadedMs: null,
    });
  });

  it('summarises timing evidence', () => {
    const t = timingStats(1000);
    t.interact(1340);
    t.interact(2000);
    for (const d of [16, 17, 16, 18, 15]) t.frame(d);
    for (const late of [2, 4, -1]) t.lag(late);
    t.visibility();
    t.focus();
    t.focus();
    const s = t.summary(5000, 5003, 210);
    expect(s.firstInteractionMs).toBe(340);
    expect(s.rafJitterMs).toBeCloseTo(Math.sqrt(1.04));
    expect(s.eventLoopLagMs).toBe(2);
    expect(s.clockDriftMs).toBe(3);
    expect(s.visibilityChanges).toBe(1);
    expect(s.focusChanges).toBe(2);
    expect(s.domContentLoadedMs).toBe(210);
  });
});
