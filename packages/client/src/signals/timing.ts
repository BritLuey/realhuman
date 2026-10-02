import type { TimingSignals } from '@realhuman/schema';
import { now, push, type Scope, stat, variance } from '../util.js';

export interface TimingStats {
  /** Any pointer/key/touch/wheel input, `t` on the performance.now() clock. */
  interact(t: number): void;
  frame(delta: number): void;
  lag(lateness: number): void;
  visibility(): void;
  focus(): void;
  summary(perfElapsed: number, wallElapsed: number, domContentLoaded: number | null): TimingSignals;
}

export function timingStats(start: number): TimingStats {
  let first: number | null = null;
  let visibility = 0;
  let focus = 0;
  const frames = stat();
  const lag = stat();
  return {
    interact(t) {
      if (first === null) first = Math.max(0, t - start);
    },
    frame: (delta) => push(frames, delta),
    lag: (late) => push(lag, Math.max(0, late)),
    visibility: () => void visibility++,
    focus: () => void focus++,
    summary: (perf, wall, dcl) => ({
      firstInteractionMs: first,
      rafJitterMs: Math.sqrt(variance(frames)),
      eventLoopLagMs: lag.mean,
      clockDriftMs: wall - perf,
      visibilityChanges: visibility,
      focusChanges: focus,
      domContentLoadedMs: dcl,
    }),
  };
}

/** `domContentLoadedEventEnd` from navigation timing, or null. */
export function domContentLoaded(): number | null {
  const entry = performance.getEntriesByType?.('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  return entry?.domContentLoadedEventEnd || null;
}

const FRAMES = 60;
const LAG_SAMPLES = 20;
const LAG_INTERVAL = 50;

export function collectTiming(s: Scope, start: number): TimingStats {
  const k = timingStats(start);
  const interact = () => k.interact(now());
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel']) {
    s.on(window, type, interact);
  }
  s.on(document, 'visibilitychange', k.visibility);
  // Bubble phase on window only, so element focus events are not counted.
  const passive = { passive: true };
  s.on(window, 'focus', k.focus, passive);
  s.on(window, 'blur', k.focus, passive);

  let frames = 0;
  let last = -1;
  const tick = () => {
    const t = now();
    if (last >= 0) k.frame(t - last);
    last = t;
    if (++frames <= FRAMES) s.frame(tick);
  };
  s.frame(tick);

  let samples = 0;
  const sample = () => {
    const due = now() + LAG_INTERVAL;
    s.wait(() => {
      k.lag(now() - due);
      if (++samples < LAG_SAMPLES) sample();
    }, LAG_INTERVAL);
  };
  sample();
  return k;
}
