import type { Integration } from '../types.js';
import { globalValue, whenReady } from './wait.js';

type Gtag = (command: 'event', name: string, params: Record<string, unknown>) => void;

/** Google Analytics 4: sends a `bot_verdict` event with `real_human`, `rh_label`, `verdict` and `rh_sid`. */
export function ga4(): Integration {
  return {
    name: 'ga4',
    onResult(r) {
      whenReady(
        () => globalValue<Gtag>('gtag'),
        (gtag) =>
          gtag('event', 'bot_verdict', {
            real_human: r.realHuman,
            rh_label: r.label,
            verdict: r.verdict,
            rh_sid: r.sid,
          }),
      );
    },
  };
}
