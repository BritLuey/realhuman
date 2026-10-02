# Jev engine

By default, realHuman decides using its built-in **algorithmic** engine: a set of weighted rules. As an
alternative, you can let **Jev**, TypeSafe AI's decision model, make the call.

## What is Jev?

Jev is a *System One model* from [TypeSafe AI](https://typesafe.ai/blog/introducing-system-one-models-and-jev).
Unlike a chatbot model, it doesn't write text. You give it a description of a situation and some typed
questions, and it returns **probabilities**, typically within 70–500 ms. That makes it a good fit for
"how likely is it that this session is human?"

## Algorithmic or Jev?

| | `algorithmic` (default) | `jev` |
|---|---|---|
| Cost | Free | Pay per call to your provider (see [cost](#cost)) |
| Speed | About 1 ms | 70–500 ms, capped by `timeoutMs` |
| Explainability | Every reason code maps to a fixed rule | Jev answers; realHuman still records reason codes for the evidence |
| Data leaves your infrastructure | No | Yes: signal summaries go to your provider |
| Picks up patterns no rule covers | No | Yes |
| Extra package | No | `@realhuman/jev` |

**Recommendation:** start with `algorithmic`. Try Jev in [shadow mode](shadow-mode.md) and switch only if it
does better on your traffic.

## Setup

### Step 1: Install

```bash
npm install @realhuman/jev
```

### Step 2: Get an API key from one provider

Jev is available through several providers. Choose one:

| Provider | `provider` value | Where to get a key | Default env variable |
|---|---|---|---|
| **Vercel AI Gateway** | `'vercel-ai-gateway'` | Vercel dashboard → AI Gateway → API keys | `AI_GATEWAY_API_KEY` |
| **OpenRouter** | `'openrouter'` | openrouter.ai → Keys | `OPENROUTER_API_KEY` |
| **TypeSafe AI (direct)** | `'typesafe'` | TypeSafe AI (access may be waitlisted) | `TYPESAFE_AI_API_KEY` |

> [!TIP]
> On Vercel you don't need an AI Gateway key at all. When `AI_GATEWAY_API_KEY` isn't set, the adapter
> uses the project's built-in OIDC token (`VERCEL_OIDC_TOKEN`) automatically.

Store the key as an environment variable, the same way you stored `REALHUMAN_SECRET`.

### Step 3: Configure

You tell realHuman **which provider** to use and **the name of the environment variable** holding the key.
You never put the key itself in code:

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

That's all you need. Every other option has a safe default.

## All options

```ts
jev({
  provider: 'vercel-ai-gateway',     // 'vercel-ai-gateway' | 'openrouter' | 'typesafe' | 'ai-sdk' | custom provider
  apiKeyEnv: 'AI_GATEWAY_API_KEY',   // env variable NAME holding the key (defaults per provider, see above)
  model: 'typesafe-ai/jev',          // defaults per provider, see below
  timeoutMs: 800,                    // if Jev hasn't answered by then, the algorithmic engine answers
  failover: [                        // other providers to try, in order, if the first is unavailable
    { provider: 'openrouter', apiKeyEnv: 'OPENROUTER_API_KEY' },
  ],
  zeroDataRetention: true,           // ask the provider not to retain request data (where supported)
});
```

| Provider | Default `model` |
|---|---|
| `vercel-ai-gateway` | `typesafe-ai/jev` |
| `openrouter` | `typesafe/jev-latest` |
| `typesafe` | `jev-latest` |
| `ai-sdk` | pass an AI SDK model, e.g. `gateway.evaluationModel('typesafe-ai/jev')` |

> [!WARNING]
> **OpenRouter's evaluation endpoint is not yet verified.** realHuman assumes TypeSafe's API shape at
> `https://openrouter.ai/api/v1/systemone`. If OpenRouter publishes a different route, override it with `baseUrl`.

### Failover

realHuman moves to the next provider in `failover` only when a provider is **unavailable**: HTTP 402
(billing), 429 (rate limit), 5xx, or a network error. A bad request (other 4xx) or a refusal stops immediately.
All providers share one `timeoutMs` budget. If every provider fails, or the budget runs out, the **algorithmic engine** answers.
The record then says `engine: "algorithmic-fallback"` and includes the reason code `jev_unavailable`, so
your data never has gaps.

### Using the AI SDK or your own provider

- **`provider: 'ai-sdk'`** with `model: gateway.evaluationModel('typesafe-ai/jev')` (or any AI SDK
  evaluation model) uses the AI SDK's `experimental_evaluate`. This needs the `ai` package, version 7 or later.
  The AI SDK reads its own API key, so `apiKeyEnv` is ignored, and `'ai-sdk'` can't be used in `failover`.
- **A custom provider** is an object with a `name` and an `evaluate(request, { signal, env })` method that returns
  answers such as `{ human: { type: 'boolean', probability: 0.93 }, kind: { type: 'choice', choice: 'human' } }`.
  Throw `JevProviderError` with `retryable: true` to let failover move on. Use it for proxies or new providers.

## What realHuman sends to Jev

**Not sent:** IP addresses, raw user-agent strings, the raw JA4 fingerprint or its hashes, the browser's time
zone name, session ids, your `context` join keys, or anything typed or clicked.

**Sent:** the same signal summaries described in [Signals](../reference/signals.md), the network
consistency checks (for example "TLS fingerprint matches the claimed browser: yes/no") the parts of the
JA4 fingerprint, and the algorithmic engine's evidence codes with their weights, together with two questions:

| Question | Type | Becomes |
|---|---|---|
| `human`: "Is this browser session operated by a real human?" | Boolean | `realHuman` (the probability of *true*) |
| `kind`: "What is driving this session?" (human, privacy browser, automation framework, scraper, AI agent) | Choice | `kind` and `confidence` |

The question wording is versioned (`questionsVersion` in each record), so you can tell which wording
produced which scores.

## How Jev affects the label

The evidence levels are always worked out from the signals, exactly as with the algorithmic engine. Jev's
probability can then settle cases the evidence left open:

- At or below `thresholds.bot` (default 0.3), the label becomes `bot`.
- At or above `thresholds.human` (default 0.7), `unverified` becomes `human`.
- Jev never overrides a `bot` label and never clears `suspicious`.

When Jev moves a label, `primaryReason` is `jev_decision`. Details:
[Understanding results](understanding-results.md#with-the-jev-engine).

## What still happens without Jev

Even with `engine: jev(…)`:

- **Gates run first.** Conclusive evidence (a filled honeypot, automation framework globals, a non-browser
  TLS fingerprint) is decided instantly, without calling Jev. This saves money and keeps certain answers certain.
- **Verified agents** with a valid Web Bot Auth signature are labelled without calling Jev.

## Cost

Jev is billed per input token; at the time of writing, output is free. A realHuman request is roughly
2,500 characters, comfortably under 1,500 input tokens. At the published TypeSafe rate of **$0.042 per million input tokens**, that's at most about
**$0.06 per 1,000 calls**, or **$63 per million**. Each update (`seq`) is one call, and provider prices
may differ. Check your provider's current pricing.

To reduce cost:

- In `server` delivery mode, Jev runs after the response is sent, so a higher `timeoutMs` costs nothing in latency.
- Call `rh.score()` only where it matters.
- Gated sessions (obvious bots) never reach Jev.

## Privacy note

With Jev, signal summaries are sent to your chosen provider, plus Vercel or OpenRouter if they sit in
between. Add them to your list of data processors (subprocessors) and check their data-retention terms.
`zeroDataRetention: true` asks Vercel AI Gateway to route only to providers that don't retain data. Over
OpenRouter or TypeSafe directly no such flag is sent, so check their retention terms. See
[Privacy & compliance](../operations/privacy-and-compliance.md#jev-engine).
