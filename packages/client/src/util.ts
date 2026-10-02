// Small shared helpers: running statistics, number clamping and a lifecycle scope that
// owns every listener, timer and observer so destroy() can remove them all.

/** Welford running mean/variance. O(1) per sample, nothing retained. */
export interface Stat {
  n: number;
  mean: number;
  m2: number;
}

export const stat = (): Stat => ({ n: 0, mean: 0, m2: 0 });

export function push(s: Stat, x: number): void {
  const d = x - s.mean;
  s.mean += d / ++s.n;
  s.m2 += d * (x - s.mean);
}

/** Population variance; 0 with fewer than two samples. */
export const variance = (s: Stat): number => (s.n < 2 ? 0 : Math.max(0, s.m2 / s.n));

/** Coefficient of variation: stddev / mean. 0 when the mean is 0 or n < 2. */
export const cv = (s: Stat): number =>
  s.n < 2 || !s.mean ? 0 : Math.sqrt(variance(s)) / Math.abs(s.mean);

export const ratio = (part: number, total: number): number => (total ? part / total : 0);

const DAY_MS = 86_400_000;

/**
 * Serialises a payload with every number rounded to 4 decimals and capped at the schema's limits:
 * one day for `…Ms` durations, 1,000,000 for counts and everything else. NaN becomes 0.
 */
export const toJson = (value: unknown): string =>
  JSON.stringify(value, (key, v: unknown) =>
    typeof v === 'number'
      ? Number.isNaN(v)
        ? 0
        : Math.min(Math.round(v * 1e4) / 1e4, key.endsWith('Ms') ? DAY_MS : 1e6)
      : v,
  );

/** Random lowercase base-36 string. */
export function token(length = 6): string {
  let out = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(length)))
    out += (byte % 36).toString(36);
  return out;
}

export const now = (): number => performance.now();

/** Event time on the performance.now() clock. */
export const stamp = (e: Event): number => e.timeStamp || now();

export interface Scope {
  /** Adds a listener (passive and capturing unless `options` says otherwise) that never throws. */
  on<E extends Event = Event>(
    target: EventTarget,
    type: string,
    fn: (e: E) => void,
    options?: AddEventListenerOptions,
  ): void;
  /** setTimeout that is cancelled on stop. */
  wait(fn: () => void, delay: number): void;
  /** requestAnimationFrame that is cancelled on stop. */
  frame(fn: () => void): void;
  /** Runs `fn` when the browser is idle (or soon, without requestIdleCallback). */
  idle(fn: () => void): void;
  /** Registers extra cleanup, for example an observer's disconnect. */
  add(cleanup: () => void): void;
  /** Wraps `fn` so errors are logged (in debug) instead of thrown into host code. */
  safe<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
  stop(): void;
}

const PASSIVE: AddEventListenerOptions = { capture: true, passive: true };

export function scope(log: (...args: unknown[]) => void): Scope {
  const cleanups = new Set<() => void>();
  const safe =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      try {
        fn(...args);
      } catch (error) {
        log(error);
      }
    };
  // Schedules a callback and registers its cancel function, removing it once it has run.
  const track = <H>(start: (run: () => void) => H, cancel: (handle: H) => void, fn: () => void) => {
    const remove = () => cancel(handle);
    const handle = start(
      safe(() => {
        cleanups.delete(remove);
        fn();
      }),
    );
    cleanups.add(remove);
  };
  return {
    on(target, type, fn, options = PASSIVE) {
      const handler = safe(fn as (e: Event) => void);
      target.addEventListener(type, handler, options);
      cleanups.add(() => target.removeEventListener(type, handler, options));
    },
    wait: (fn, delay) => track((run) => setTimeout(run, delay), clearTimeout, fn),
    frame: (fn) => track(requestAnimationFrame, cancelAnimationFrame, fn),
    idle(fn) {
      if (typeof requestIdleCallback === 'function') {
        track((run) => requestIdleCallback(run, { timeout: 1000 }), cancelIdleCallback, fn);
      } else track((run) => setTimeout(run, 1), clearTimeout, fn);
    },
    add: (cleanup) => cleanups.add(cleanup),
    safe,
    stop() {
      for (const cleanup of cleanups) safe(cleanup)();
      cleanups.clear();
    },
  };
}
