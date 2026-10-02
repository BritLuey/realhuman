const INTERVAL_MS = 250;
const MAX_TRIES = 40; // 10 seconds

/**
 * Calls `run` with the value of `get()` once it is truthy, polling every 250 ms for up to 10 s,
 * then gives up silently. Never throws.
 */
export function whenReady<T>(
  get: () => T | null | undefined | false,
  run: (value: T) => void,
): void {
  let tries = 0;
  const tick = () => {
    try {
      const value = get();
      if (value) return run(value);
    } catch {
      return;
    }
    if (++tries < MAX_TRIES) setTimeout(tick, INTERVAL_MS);
  };
  tick();
}

/** Reads a global such as `window.newrelic` without type gymnastics at every call site. */
export const globalValue = <T>(name: string): T | undefined =>
  (globalThis as unknown as Record<string, T | undefined>)[name];
