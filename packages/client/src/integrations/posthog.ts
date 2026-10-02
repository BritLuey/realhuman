import type { Integration } from '../types.js';
import { globalValue, whenReady } from './wait.js';

interface PostHog {
  capture(event: string, properties: Record<string, unknown>): void;
  register(properties: Record<string, unknown>): void;
}

/**
 * PostHog: `posthog.capture('bot_verdict', { real_human, verdict, rh_sid })` and registers
 * `real_human` as a super property.
 */
export function posthog(): Integration {
  return {
    name: 'posthog',
    onResult(r) {
      whenReady(
        () => {
          const ph = globalValue<PostHog>('posthog');
          return typeof ph?.capture === 'function' && ph;
        },
        (ph) => {
          ph.register({ real_human: r.realHuman });
          ph.capture('bot_verdict', { real_human: r.realHuman, verdict: r.verdict, rh_sid: r.sid });
        },
      );
    },
  };
}
