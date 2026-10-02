import { describe, expect, it } from 'vitest';
import { pointerStats } from '../src/signals/pointer.js';
import { random } from './helpers.js';

describe('pointerStats', () => {
  it('flags a straight, constant-speed line', () => {
    const p = pointerStats();
    for (let i = 0; i < 50; i++) p.move(i * 8, i * 4, i * 16, true, 'mouse', 1);
    const s = p.summary();
    expect(s.events).toBe(50);
    expect(s.trustedRatio).toBe(1);
    expect(s.straightRatio).toBe(1);
    expect(s.speedCv).toBeLessThan(0.01);
    expect(s.curvatureMean).toBeLessThan(0.01);
    expect(s.speedMean).toBeCloseTo(Math.hypot(8, 4) / 16);
    expect(s.coalescedPerMove).toBe(1);
    expect(s.pauses).toBe(0);
    expect(s.pointerTypes).toEqual({ mouse: 50, pen: 0, touch: 0 });
    expect(s.pressureVariance).toBeNull();
  });

  it('sees a curved path with varied speed as natural', () => {
    const p = pointerStats();
    const r = random(7);
    let x = 100;
    let y = 100;
    let heading = 0;
    let t = 0;
    for (let i = 0; i < 120; i++) {
      heading += (r() - 0.5) * 1.2;
      const step = 2 + r() * 14;
      x += Math.cos(heading) * step;
      y += Math.sin(heading) * step;
      t += 8 + r() * 16;
      p.move(x, y, t, true, 'mouse', 2 + Math.round(r() * 2));
    }
    const s = p.summary();
    expect(s.straightRatio).toBeLessThan(0.6);
    expect(s.speedCv).toBeGreaterThan(0.3);
    expect(s.accelerationCv).toBeGreaterThan(0);
    expect(s.curvatureMean).toBeGreaterThan(0.1);
    expect(s.coalescedPerMove).toBeGreaterThan(2);
  });

  it('counts pauses and does not compute speed across them', () => {
    const p = pointerStats();
    p.move(0, 0, 0, true, 'mouse');
    p.move(10, 0, 10, true, 'mouse');
    p.move(20, 0, 500, true, 'mouse'); // 490 ms gap
    p.move(30, 0, 510, true, 'mouse');
    const s = p.summary();
    expect(s.pauses).toBe(1);
    expect(s.speedMean).toBe(1);
    expect(s.speedCv).toBe(0);
  });

  it('detects teleport and dead-centre clicks', () => {
    const p = pointerStats();
    p.click(50, 50, 100, true, true); // no move before it
    p.move(200, 200, 1000, true, 'mouse');
    p.click(205, 200, 1100, true, false); // near and recent
    p.click(500, 500, 1200, true, false); // far from the last move
    p.click(205, 200, 2000, true, false); // stale: no move in the last 500 ms
    const s = p.summary();
    expect(s.clicks).toBe(4);
    expect(s.teleportClicks).toBe(3);
    expect(s.centerClicks).toBe(1);
  });

  it('treats a touch press as a position, so taps are not teleports', () => {
    const p = pointerStats();
    p.down(40, 40, 100, true, 'touch', 0.4);
    p.click(40, 40, 150, true, false);
    p.down(90, 90, 900, true, 'touch', 0.6);
    p.click(90, 90, 950, true, false);
    const s = p.summary();
    expect(s.teleportClicks).toBe(0);
    expect(s.pressureVariance).toBeCloseTo(0.01);
  });

  it('measures the share of trusted events', () => {
    const p = pointerStats();
    p.move(0, 0, 0, true, 'pen', 1, 0.5);
    p.move(5, 5, 10, false, 'pen', 1, 0.5);
    p.click(5, 5, 20, false, false);
    p.down(5, 5, 15, true, 'mouse');
    const s = p.summary();
    expect(s.trustedRatio).toBe(0.5);
    expect(s.pointerTypes.pen).toBe(2);
    expect(s.pressureVariance).toBe(0);
  });
});
