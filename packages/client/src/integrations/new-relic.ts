import type { Integration } from '../types.js';
import { globalValue, whenReady } from './wait.js';

interface NewRelic {
  setCustomAttribute(name: string, value: string | number | null, persist?: boolean): void;
  addPageAction(name: string, attributes: Record<string, unknown>): void;
}

/**
 * New Relic Browser: sets the custom attributes `realHuman`, `realHumanVerdict` and
 * `realHumanSid` (persisted for the rest of the page view) and records a `bot_verdict` page action.
 */
export function newRelic(): Integration {
  return {
    name: 'new-relic',
    onResult(r) {
      whenReady(
        () => {
          const nr = globalValue<NewRelic>('newrelic');
          return typeof nr?.setCustomAttribute === 'function' && nr;
        },
        (nr) => {
          nr.setCustomAttribute('realHuman', r.realHuman ?? null, true);
          nr.setCustomAttribute('realHumanLabel', r.label ?? null, true);
          nr.setCustomAttribute('realHumanVerdict', r.verdict ?? null, true);
          nr.setCustomAttribute('realHumanSid', r.sid, true);
          nr.addPageAction('bot_verdict', {
            realHuman: r.realHuman,
            label: r.label,
            verdict: r.verdict,
            sid: r.sid,
          });
        },
      );
    },
  };
}
