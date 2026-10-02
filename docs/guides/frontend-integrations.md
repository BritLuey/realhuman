# Frontend integrations (New Relic, Datadog, GA4 and more)

> [!NOTE]
> **Planned: milestone M6.** This page describes the intended API.

If you set the [delivery mode](delivery-modes.md) to `client` or `both`, the browser receives the score,
and you can pass it on to any tool running in the page.

## Before you start

On your **server**, enable browser delivery:

```ts
createHandlers({ deliver: 'both' /* or 'client' */, onDecision });
```

Without this the browser receives nothing, and the integrations below do nothing.

## Ready-made integrations

Import only the ones you use. Each is a separate entry point, so the others aren't bundled.

```ts
import { init } from '@realhuman/client';
import { newRelic } from '@realhuman/client/integrations/new-relic';
import { datadogRum } from '@realhuman/client/integrations/datadog-rum';

init({ integrations: [newRelic(), datadogRum()] });
```

| Integration | Import | What it does |
|---|---|---|
| **New Relic Browser** | `integrations/new-relic` → `newRelic()` | Sets custom attributes `realHuman`, `realHumanVerdict`, `realHumanSid` (persisted for the rest of the page view) and records a `bot_verdict` page action |
| **Datadog RUM** | `integrations/datadog-rum` → `datadogRum()` | Sets global context `realhuman.score`, `realhuman.verdict`, `realhuman.sid` and adds a `bot_verdict` action |
| **Google Analytics 4** | `integrations/ga4` → `ga4()` | Sends a `bot_verdict` event with `real_human`, `verdict` and `rh_sid` parameters |
| **Google Tag Manager** | `integrations/data-layer` → `dataLayer()` | Pushes `{ event: 'realhuman_result', realHuman, verdict, sid }` to `window.dataLayer` |
| **Segment** | `integrations/segment` → `segment()` | `analytics.track('Bot Verdict', …)` |
| **PostHog** | `integrations/posthog` → `posthog()` | `posthog.capture('bot_verdict', …)` and registers `real_human` as a super property |

Each integration waits for its tool to load and does nothing if the tool isn't on the page.

> [!IMPORTANT]
> **Timing.** The first score arrives about `flushAfterMs` (1 s) after load. Events your tool recorded
> *before* then won't carry the attribute. For complete filtering, use the `bot_verdict` event and join on
> session, or filter on the backend record.

### GA4 setup

Register the event parameters as custom dimensions so they show up in reports: in GA4, go to
**Admin → Custom definitions → Create custom dimension** and add `real_human` (metric or dimension),
`verdict` and `rh_sid` (event scope).

### New Relic example query (NRQL)

```sql
SELECT count(*) FROM PageAction
WHERE actionName = 'bot_verdict'
FACET realHumanVerdict SINCE 1 day ago
```

## Your own integration

Three ways to receive results:

```ts
// 1. Callback option
init({ onResult: (r) => myTool.set('realHuman', r.realHuman) });

// 2. Instance events
rh.on('result', (r) => { /* … */ });

// 3. A DOM event, for scripts that don't import the SDK (tag managers, third-party code)
window.addEventListener('realhuman:result', (e) => {
  const r = (e as CustomEvent).detail; // { v, sid, seq, realHuman, verdict, confidence }
});
```

Or write a reusable integration:

```ts
import type { Integration } from '@realhuman/client';

export const myTool = (): Integration => ({
  name: 'my-tool',
  onResult(result) {
    window.myTool?.setAttribute('realHuman', result.realHuman);
  },
});
```

## Remember

The browser copy of the score can be changed by a determined bot before it reaches these tools. Use it for
dashboards and exploration; for anything important, filter using the
[backend record](ingesting-decisions.md).
