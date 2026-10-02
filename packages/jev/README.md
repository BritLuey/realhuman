# @realhuman/jev

Optional engine for [realHuman](../../README.md) that asks **Jev**, TypeSafe AI's decision model, whether a
session is human. You get the same decision records as with the built-in algorithmic engine, with
`engine: "jev"`.

Full guide: [Jev engine](../../docs/guides/jev-engine.md).

## Install

```bash
npm install @realhuman/jev
```

## 1. Choose a provider

| Provider | `provider` | API key env variable (default) | Default `model` |
|---|---|---|---|
| Vercel AI Gateway | `'vercel-ai-gateway'` | `AI_GATEWAY_API_KEY` (on Vercel, `VERCEL_OIDC_TOKEN` is used when it's missing) | `typesafe-ai/jev` |
| OpenRouter | `'openrouter'` | `OPENROUTER_API_KEY` | `typesafe/jev-latest` |
| TypeSafe AI directly | `'typesafe'` | `TYPESAFE_AI_API_KEY` | `jev-latest` |
| AI SDK (`ai` v7+) | `'ai-sdk'` | read by the AI SDK provider you pass | `typesafe-ai/jev` |

## 2. Set the API key

Store the key as an environment variable, like `REALHUMAN_SECRET`. You never put the key in code: you
only tell realHuman the variable's **name**.

## 3. Configure

```ts
import { createHandlers } from '@realhuman/vercel';
import { jev } from '@realhuman/jev';

export const { GET, POST } = createHandlers({
  engine: jev({
    provider: 'vercel-ai-gateway',
    apiKeyEnv: 'AI_GATEWAY_API_KEY', // the variable's NAME, not its value
  }),
  onDecision,
});
```

Every other option has a safe default:

```ts
jev({
  provider: 'vercel-ai-gateway',
  model: 'typesafe-ai/jev',
  timeoutMs: 800,          // after this, the algorithmic engine answers
  zeroDataRetention: true, // Vercel AI Gateway only: route to zero-data-retention providers
  baseUrl: undefined,      // e.g. a corporate proxy
  failover: [],            // see below
});
```

If Jev fails, times out or answers something unexpected, realHuman's algorithmic engine answers
instead. The record says `engine: "algorithmic-fallback"` and includes `jev_unavailable`, so your data has
no gaps. Obvious bots (filled honeypots, automation globals, non-browser TLS) are decided before Jev is
called, so they cost nothing.

## Failover

```ts
jev({
  provider: 'vercel-ai-gateway',
  failover: [
    { provider: 'openrouter' },
    { provider: 'typesafe', apiKeyEnv: 'MY_TYPESAFE_KEY', model: 'jev-1.13' },
  ],
});
```

The next provider is tried only when the previous one is **unavailable**: HTTP 402, 429, 5xx or a network
error. A bad request (400 and other 4xx), a refusal or a malformed answer stops immediately. All providers
share the single `timeoutMs` budget.

## AI SDK or your own provider

```ts
import { gateway } from 'ai';

jev({ provider: 'ai-sdk', model: gateway.evaluationModel('typesafe-ai/jev') });
```

A custom provider is any object with a `name` and an `evaluate(request, { signal, env })` method that
returns answers such as `{ human: { type: 'boolean', probability: 0.93 }, kind: { type: 'choice', choice: 'human' } }`.
Throw `JevProviderError` with `retryable: true` to let failover move on.

## Cost

You pay your provider per call. One realHuman request is roughly 600–1,500 input tokens; at TypeSafe's
published $0.042 per million input tokens that's about $0.03–0.06 per 1,000 calls. Each update (`seq`) is
one call. Check your provider's current prices.

## Privacy

Jev receives signal summaries (counts, ratios, timings), network consistency checks, the parts of the JA4
fingerprint and the algorithmic evidence. It never receives IP addresses, the user agent, the raw JA4
string, the browser's time zone name, your `context` join keys or session ids. `buildState(analysis)` is
exported so you can see exactly what is sent. Add your provider (and Vercel or OpenRouter, if they sit in
between) to your list of data processors.

## OpenRouter caveat

OpenRouter's evaluation endpoint is **not verified**. This package assumes it mirrors TypeSafe's API at
`https://openrouter.ai/api/v1/systemone`. If OpenRouter documents a different endpoint, set `baseUrl`, or
use Vercel AI Gateway or TypeSafe directly.
