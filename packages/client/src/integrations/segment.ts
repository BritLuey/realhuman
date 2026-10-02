import type { Integration } from '../types.js';
import { globalValue, whenReady } from './wait.js';

interface Analytics {
  track(event: string, properties: Record<string, unknown>): void;
}

/** Segment: `analytics.track('Bot Verdict', { realHuman, verdict, sid })`. */
export function segment(): Integration {
  return {
    name: 'segment',
    onResult(r) {
      whenReady(
        () => {
          const analytics = globalValue<Analytics>('analytics');
          return typeof analytics?.track === 'function' && analytics;
        },
        (analytics) =>
          analytics.track('Bot Verdict', {
            realHuman: r.realHuman,
            verdict: r.verdict,
            sid: r.sid,
          }),
      );
    },
  };
}
