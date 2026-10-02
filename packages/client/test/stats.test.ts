import { describe, expect, it } from 'vitest';
import { cv, push, ratio, stat, toJson, token, variance } from '../src/util.js';

describe('running statistics', () => {
  it('matches the textbook mean and population variance', () => {
    const s = stat();
    for (const x of [2, 4, 4, 4, 5, 5, 7, 9]) push(s, x);
    expect(s.n).toBe(8);
    expect(s.mean).toBe(5);
    expect(variance(s)).toBeCloseTo(4);
    expect(cv(s)).toBeCloseTo(2 / 5);
  });

  it('returns 0 for fewer than two samples or a zero mean', () => {
    const s = stat();
    expect(variance(s)).toBe(0);
    expect(cv(s)).toBe(0);
    push(s, 3);
    expect(cv(s)).toBe(0);
    const zero = stat();
    push(zero, -1);
    push(zero, 1);
    expect(cv(zero)).toBe(0);
  });

  it('ratio is 0 without a denominator', () => {
    expect(ratio(1, 0)).toBe(0);
    expect(ratio(1, 4)).toBe(0.25);
  });
});

describe('toJson', () => {
  it('rounds to 4 decimals and caps durations and counts', () => {
    const json = toJson({ a: 1 / 3, holdMeanMs: 1e12, events: 5e6, n: Number.NaN, s: 'x' });
    expect(JSON.parse(json)).toEqual({
      a: 0.3333,
      holdMeanMs: 86_400_000,
      events: 1_000_000,
      n: 0,
      s: 'x',
    });
  });
});

describe('token', () => {
  it('is random lowercase base-36', () => {
    expect(token()).toMatch(/^[0-9a-z]{6}$/);
    expect(token(10)).toHaveLength(10);
    expect(new Set(Array.from({ length: 20 }, () => token())).size).toBeGreaterThan(15);
  });
});
