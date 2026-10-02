import type { Integration } from '../types.js';
import { globalValue, whenReady } from './wait.js';

interface DatadogRum {
  setGlobalContextProperty?(key: string, value: unknown): void;
  addAction(name: string, context?: Record<string, unknown>): void;
}

/**
 * Datadog RUM: sets the global context property `realhuman` to `{ score, verdict, sid }` and adds
 * a `bot_verdict` action.
 */
export function datadogRum(): Integration {
  return {
    name: 'datadog-rum',
    onResult(r) {
      whenReady(
        () => {
          const rum = globalValue<DatadogRum>('DD_RUM');
          return typeof rum?.addAction === 'function' && rum;
        },
        (rum) => {
          rum.setGlobalContextProperty?.('realhuman', {
            score: r.realHuman,
            verdict: r.verdict,
            sid: r.sid,
          });
          rum.addAction('bot_verdict', { realHuman: r.realHuman, verdict: r.verdict, sid: r.sid });
        },
      );
    },
  };
}
