import { describe, expect, it } from 'vitest';
import { keyboardStats, keyClass, scrollStats, touchStats } from '../src/signals/input.js';

describe('keyClass', () => {
  it.each([
    ['a', 'character'],
    ['Z', 'character'],
    [' ', 'character'],
    ['7', 'character'],
    ['Backspace', 'editing'],
    ['Delete', 'editing'],
    ['ArrowLeft', 'navigation'],
    ['Tab', 'navigation'],
    ['Enter', 'navigation'],
    ['PageDown', 'navigation'],
    ['Escape', 'navigation'],
    ['Shift', 'modifier'],
    ['AltGraph', 'modifier'],
    ['CapsLock', 'modifier'],
    ['F5', null],
    ['Unidentified', null],
  ])('%s is %s', (key, expected) => {
    expect(keyClass(key)).toBe(expected);
  });
});

describe('keyboardStats', () => {
  it('summarises hold times and gaps without keeping keys', () => {
    const k = keyboardStats();
    const holds = [80, 120, 95, 140];
    const gaps = [150, 260, 180];
    let t = 0;
    holds.forEach((hold, i) => {
      k.down(`Key${i}`, 'abcd'[i] ?? 'x', t, true, false);
      k.up(`Key${i}`, t + hold);
      t += gaps[i] ?? 0;
    });
    const s = k.summary();
    expect(s.events).toBe(4);
    expect(s.holdMeanMs).toBeCloseTo(108.75);
    expect(s.holdCv).toBeGreaterThan(0.1);
    expect(s.gapMeanMs).toBeCloseTo(196.67, 1);
    expect(s.keyClasses).toEqual({ character: 4, editing: 0, navigation: 0, modifier: 0 });
    expect(JSON.stringify(s)).not.toMatch(/Key0|"a"/);
  });

  it('gives robotic, evenly spaced typing a zero gap CV', () => {
    const k = keyboardStats();
    for (let i = 0; i < 10; i++) {
      k.down('KeyA', 'a', i * 100, false, false);
      k.up('KeyA', i * 100 + 50);
    }
    const s = k.summary();
    expect(s.gapCv).toBe(0);
    expect(s.holdCv).toBe(0);
    expect(s.trustedRatio).toBe(0);
  });

  it('ignores auto-repeat and long gaps, and counts pastes', () => {
    const k = keyboardStats();
    k.down('Backspace', 'Backspace', 0, true, false);
    k.down('Backspace', 'Backspace', 30, true, true);
    k.down('ShiftLeft', 'Shift', 5000, true, false);
    k.up('ShiftLeft', 5100);
    k.up('Unknown', 5200);
    k.paste();
    const s = k.summary();
    expect(s.events).toBe(2);
    expect(s.gapMeanMs).toBe(0);
    expect(s.holdMeanMs).toBe(100);
    expect(s.pastes).toBe(1);
    expect(s.keyClasses).toEqual({ character: 0, editing: 1, navigation: 0, modifier: 1 });
  });
});

describe('touchStats', () => {
  it('summarises taps, contact size, force and multi-touch', () => {
    const t = touchStats();
    t.start(0, true, 1, [{ radiusX: 10, radiusY: 12, force: 0.5 }]);
    t.end(80, 0);
    t.start(500, true, 1, [{ radiusX: 14, radiusY: 11, force: 0.7 }]);
    t.end(620, 0);
    t.start(1000, true, 2, [{ radiusX: 9, radiusY: 9 }]);
    t.end(1100, 1);
    t.end(1150, 0);
    const s = t.summary();
    expect(s.events).toBe(3);
    expect(s.trustedRatio).toBe(1);
    expect(s.multiTouch).toBe(1);
    expect(s.tapMeanMs).toBeCloseTo((80 + 120 + 150) / 3);
    expect(s.radiusVariance).toBeGreaterThan(0);
    expect(s.forceVariance).toBeCloseTo(0.01);
  });

  it('reports null variance when the device gives no radius or force', () => {
    const t = touchStats();
    t.start(0, false, 1, [{ radiusX: 0, radiusY: 0, force: 0 }]);
    t.end(0, 0);
    const s = t.summary();
    expect(s.radiusVariance).toBeNull();
    expect(s.forceVariance).toBeNull();
    expect(s.trustedRatio).toBe(0);
    expect(s.tapMeanMs).toBe(0);
  });
});

describe('scrollStats', () => {
  it('detects programmatic, evenly stepped wheel scrolling', () => {
    const s = scrollStats();
    for (let i = 0; i < 10; i++) s.wheel(i * 100, 0, 100);
    const out = s.summary();
    expect(out.wheelEvents).toBe(10);
    expect(out.quantizedRatio).toBe(0.9);
    expect(out.cadenceCv).toBe(0);
    expect(out.deltaModes).toEqual({ pixel: 10, line: 0, page: 0 });
  });

  it('sees bursty human scrolling as varied', () => {
    const s = scrollStats();
    const times = [0, 16, 35, 50, 400, 420, 431, 1500, 1510, 1540];
    const deltas = [4, 12, 30, 18, 6, 3, 40, 22, 9, 1];
    times.forEach((t, i) => {
      s.wheel(t, i === 9 ? 1 : 0, deltas[i] ?? 0);
      s.scroll(t + 1);
    });
    const out = s.summary();
    expect(out.events).toBe(20);
    expect(out.quantizedRatio).toBe(0);
    expect(out.cadenceCv).toBeGreaterThan(0.3);
    expect(out.deltaModes).toEqual({ pixel: 9, line: 1, page: 0 });
  });
});
