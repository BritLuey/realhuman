// Entry for dist/realhuman.iife.js: <script src="/realhuman.js" data-endpoint="…" defer>.
import { init, type RealHumanInstance, type RealHumanOptions } from './index.js';

declare global {
  interface Window {
    realHuman?: RealHumanInstance;
  }
}

/** Maps the script tag's data attributes to options. */
export function optionsFromScript(script: HTMLOrSVGScriptElement | null): RealHumanOptions {
  const data = script?.dataset ?? {};
  const flush = Number(data.flushAfterMs);
  return {
    ...(data.endpoint ? { endpoint: data.endpoint } : {}),
    ...(data.flushAfterMs && Number.isFinite(flush) ? { flushAfterMs: flush } : {}),
    ...(data.consent === 'false' ? { consent: false } : {}),
    ...(data.awsContentHash === 'true' ? { awsContentHash: true } : {}),
    ...(data.debug === 'true' ? { debug: true } : {}),
  };
}

if (typeof window !== 'undefined') {
  window.realHuman = init(optionsFromScript(document.currentScript));
}
