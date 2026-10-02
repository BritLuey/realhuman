import { createClient } from './client.js';
import type { RealHumanInstance, RealHumanOptions } from './types.js';

export type {
  ClientResult,
  CollectorOptions,
  ContextValue,
  HoneypotOptions,
  Integration,
  RealHumanInstance,
  RealHumanOptions,
} from './types.js';
export { VERSION } from './version.js';

let current: RealHumanInstance | null = null;

/** An instance that does nothing: used during server-side rendering and if start-up fails. */
const inert = (): RealHumanInstance => ({
  sid: '',
  ready: Promise.resolve(null),
  score: () => Promise.resolve(null),
  on() {},
  off() {},
  attach() {},
  grantConsent() {},
  setContext() {},
  destroy() {},
});

/**
 * Starts realHuman for this page load and returns the instance.
 *
 * Call it once, as early as possible. Calling it again returns the existing instance (the new
 * options are ignored) until that instance is destroyed. Without `window` (server-side
 * rendering) it returns an inert instance whose `ready` resolves to `null`.
 */
export function init(options: RealHumanOptions = {}): RealHumanInstance {
  if (typeof window === 'undefined' || typeof document === 'undefined') return inert();
  if (current) return current;
  try {
    const instance = createClient(options, () => {
      if (current === instance) current = null;
    });
    current = instance;
    return instance;
  } catch {
    return inert();
  }
}
