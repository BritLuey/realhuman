# Delivery modes: who gets the result?

When realHuman makes a decision, it can deliver it to **your backend**, to **the browser**, or to **both**.
You choose with a single server-side setting, `deliver`.

## The three modes

| Mode | Your backend (`onDecision`) | The browser | Use it when… |
|---|---|---|---|
| **`server`** (default) | ✅ Full decision record | ❌ Gets `204 No Content` | You filter data in your warehouse or pipeline |
| **`client`** | ❌ | ✅ Score only | Your only consumers are browser tools (New Relic, Datadog RUM, GA4…) |
| **`both`** | ✅ Full decision record | ✅ Score only | You want the warehouse record *and* the score in browser tools |

```ts
createHandlers({
  deliver: 'both',
  clientFields: ['realHuman', 'verdict', 'confidence'], // what the browser may see
  onDecision: async (record) => { /* your pipeline */ },
});
```

## Why the setting lives on the server

The browser can't switch itself into `client` mode. Only your server configuration decides what's
exposed. That means:

- one place controls what leaves your server;
- in `server` mode, automated clients learn nothing from the response, which makes the system harder to probe.

## What the browser can receive

Only the fields you list in `clientFields` (default: `realHuman`, `verdict`, `confidence`), plus `sid` and
`seq`. **Reason codes, signals and network facts are never sent to the browser**, whatever you configure,
because they would show bots exactly what to fix.

```json
{ "v": 1, "sid": "k3J9x0aQ2mW8pL5rT7yB", "seq": 0, "realHuman": 0.91, "verdict": "human", "confidence": 0.64 }
```

## Updates, `seq` and the "final" answer

One page load can produce several decisions:

| When | `seq` | `final` | Browser gets a result? |
|---|---|---|---|
| After `flushAfterMs` | 0 | false | Yes (client/both) |
| Each `rh.score()` call | 1, 2, … | false | Yes (client/both) |
| Page closing | next number | true | No: the page is gone |

Rules for your backend:

1. **Keep one row per `sid`**, and replace it whenever a record with a **higher `seq`** arrives.
2. **Don't wait for `final: true`.** Browsers, especially on mobile, often kill a closing page before
   anything can be sent. Whatever has the highest `seq` *is* the final answer.

[Ingesting decisions](ingesting-decisions.md) has ready-to-use SQL for this.

## Speed

- **`server` mode** answers `204`. On Vercel and Node.js it answers straight away, and scoring and your
  `onDecision` code run *after* the response is sent, so even the slower [Jev engine](jev-engine.md) adds no
  delay. On AWS Lambda they finish *before* the response is returned, because Lambda pauses as soon as it
  responds. Either way, nothing on the page waits for it.
- **`client` and `both` modes** wait for the score before responding: a few milliseconds for the algorithmic
  engine, typically 70–500 ms for Jev (capped by `timeoutMs`). The visitor never notices, because nothing on
  the page waits for it.

## A word on trust

The copy of the score that reaches the browser passes through a machine the visitor controls. A
determined bot could change it before it reaches New Relic or GA4.

**Your backend record is the source of truth.** Treat browser-side copies as a convenience for dashboards.
If anything important depends on the score, filter using the backend record, joined on `sid`. See
[Filtering your data](filtering-your-data.md).
