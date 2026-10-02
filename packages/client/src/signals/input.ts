// Keyboard, touch and scroll summarisers. Each pure summariser is fed samples by a small
// collect* function, so the maths can be tested without trusted DOM events.
import type { KeyboardSignals, ScrollSignals, TouchSignals } from '@realhuman/schema';
import { cv, push, ratio, type Scope, stamp, stat, variance } from '../util.js';

type KeyClass = keyof KeyboardSignals['keyClasses'];

const NAVIGATION = /^(Arrow\w+|Tab|Home|End|PageUp|PageDown|Enter|Escape)$/;
const MODIFIER = /^(Shift|Control|Alt|Meta|CapsLock|AltGraph)$/;

/** The class of a `KeyboardEvent.key`. The key itself is never kept. */
export function keyClass(key: string): KeyClass | null {
  if (key.length === 1) return 'character';
  if (key === 'Backspace' || key === 'Delete') return 'editing';
  if (NAVIGATION.test(key)) return 'navigation';
  return MODIFIER.test(key) ? 'modifier' : null;
}

export interface KeyboardStats {
  down(code: string, key: string, t: number, trusted: boolean, repeat: boolean): void;
  up(code: string, t: number): void;
  paste(): void;
  summary(): KeyboardSignals;
}

export function keyboardStats(): KeyboardStats {
  let events = 0;
  let trusted = 0;
  let pastes = 0;
  let lastDown = -1;
  const classes = { character: 0, editing: 0, navigation: 0, modifier: 0 };
  const hold = stat();
  const gap = stat();
  // Physical key code -> keydown time, only until the matching keyup.
  const pressed = new Map<string, number>();
  return {
    down(code, key, t, isTrusted, repeat) {
      if (repeat) return;
      events++;
      if (isTrusted) trusted++;
      const c = keyClass(key);
      if (c) classes[c]++;
      if (lastDown >= 0 && t >= lastDown && t - lastDown <= 2000) push(gap, t - lastDown);
      lastDown = t;
      if (pressed.size > 16) pressed.clear();
      pressed.set(code, t);
    },
    up(code, t) {
      const start = pressed.get(code);
      if (start === undefined) return;
      pressed.delete(code);
      if (t >= start) push(hold, t - start);
    },
    paste: () => void pastes++,
    summary: () => ({
      events,
      trustedRatio: ratio(trusted, events),
      holdMeanMs: hold.mean,
      holdCv: cv(hold),
      gapMeanMs: gap.mean,
      gapCv: cv(gap),
      pastes,
      keyClasses: { ...classes },
    }),
  };
}

export function collectKeyboard(s: Scope): KeyboardStats {
  const k = keyboardStats();
  s.on<KeyboardEvent>(window, 'keydown', (e) =>
    k.down(e.code, e.key ?? '', stamp(e), e.isTrusted, e.repeat),
  );
  s.on<KeyboardEvent>(window, 'keyup', (e) => k.up(e.code, stamp(e)));
  s.on(document, 'paste', k.paste);
  return k;
}

interface TouchPoint {
  readonly radiusX?: number;
  readonly radiusY?: number;
  readonly force?: number;
}

export interface TouchStats {
  /** `active`: touches on the surface; `changed`: the touches that just started. */
  start(t: number, trusted: boolean, active: number, changed: ArrayLike<TouchPoint>): void;
  end(t: number, active: number): void;
  summary(): TouchSignals;
}

export function touchStats(): TouchStats {
  let events = 0;
  let trusted = 0;
  let multi = 0;
  let began = -1;
  const radius = stat();
  const force = stat();
  const tap = stat();
  return {
    start(t, isTrusted, active, changed) {
      events++;
      if (isTrusted) trusted++;
      if (active > 1) multi++;
      if (began < 0) began = t;
      for (let i = 0; i < changed.length; i++) {
        const p = changed[i];
        if (p?.radiusX) push(radius, p.radiusX);
        if (p?.radiusY) push(radius, p.radiusY);
        if (p?.force) push(force, p.force);
      }
    },
    end(t, active) {
      if (active || began < 0) return;
      push(tap, t - began);
      began = -1;
    },
    summary: () => ({
      events,
      trustedRatio: ratio(trusted, events),
      radiusVariance: radius.n ? variance(radius) : null,
      forceVariance: force.n ? variance(force) : null,
      multiTouch: multi,
      tapMeanMs: tap.mean,
    }),
  };
}

export function collectTouch(s: Scope): TouchStats {
  const k = touchStats();
  s.on<TouchEvent>(window, 'touchstart', (e) =>
    k.start(stamp(e), e.isTrusted, e.touches.length, e.changedTouches),
  );
  const end = (e: TouchEvent) => k.end(stamp(e), e.touches.length);
  s.on(window, 'touchend', end);
  s.on(window, 'touchcancel', end);
  return k;
}

export interface ScrollStats {
  scroll(t: number): void;
  wheel(t: number, deltaMode: number, deltaY: number): void;
  summary(): ScrollSignals;
}

export function scrollStats(): ScrollStats {
  let events = 0;
  let wheels = 0;
  let quantized = 0;
  let lastT = -1;
  let lastDelta = -1;
  const modes = { pixel: 0, line: 0, page: 0 };
  const cadence = stat();
  const tick = (t: number) => {
    events++;
    if (lastT >= 0 && t >= lastT) push(cadence, t - lastT);
    lastT = t;
  };
  return {
    scroll: tick,
    wheel(t, mode, deltaY) {
      tick(t);
      wheels++;
      const name = (['pixel', 'line', 'page'] as const)[mode];
      if (name) modes[name]++;
      const d = Math.abs(deltaY);
      if (d === lastDelta) quantized++;
      lastDelta = d;
    },
    summary: () => ({
      events,
      wheelEvents: wheels,
      deltaModes: { ...modes },
      quantizedRatio: ratio(quantized, wheels),
      cadenceCv: cv(cadence),
    }),
  };
}

export function collectScroll(s: Scope): ScrollStats {
  const k = scrollStats();
  s.on(window, 'scroll', (e) => k.scroll(stamp(e)));
  s.on<WheelEvent>(window, 'wheel', (e) => k.wheel(stamp(e), e.deltaMode, e.deltaY));
  return k;
}
