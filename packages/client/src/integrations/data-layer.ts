import type { Integration } from '../types.js';

/**
 * Google Tag Manager: pushes `{ event: 'realhuman_result', realHuman, verdict, sid }` to
 * `window.dataLayer`, creating it if needed (GTM reads queued entries when it loads).
 */
export function dataLayer(): Integration {
  return {
    name: 'data-layer',
    onResult(r) {
      try {
        const w = globalThis as unknown as { dataLayer?: unknown[] };
        w.dataLayer ||= [];
        w.dataLayer.push({
          event: 'realhuman_result',
          realHuman: r.realHuman,
          verdict: r.verdict,
          sid: r.sid,
        });
      } catch {}
    },
  };
}
