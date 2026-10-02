# Configuration reference

Every option, with its type and default. If you only change a few things, the
[quickstarts](../README.md#start-here) are a better starting point.

- [Browser SDK](#browser-sdk) (`@realhuman/client`)
- [Engine options](#engine-options), shared by every adapter
- [Vercel adapter](#vercel-adapter) (`@realhuman/vercel`)
- [AWS adapter](#aws-adapter) (`@realhuman/aws`)
- [Node adapter](#node-adapter) (`@realhuman/node`)
- [Jev engine](#jev-engine) (`@realhuman/jev`)

---

## Browser SDK

`init(options?)` from `@realhuman/client`.

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | `string` | `'/api/realhuman'` | Path (or absolute URL) of your server route. Same-origin is strongly recommended. |
| `flushAfterMs` | `number` | `1000` | Milliseconds after `init()` before the first update is sent. Allowed range: 250–60000. |
| `sendOnPageHide` | `boolean` | `true` | Send a final update when the page is hidden or closed. |
| `consent` | `boolean` | `true` | When `false`, nothing is collected or sent until `grantConsent()` is called. |
| `context` | `Record<string, string>` or `() => Record<string, string>` | `{}` | Your own join keys, copied into decision records. At most 10 keys; values at most 256 characters. A function is called when each update is sent. |
| `honeypot` | `false` or [`HoneypotOptions`](#honeypotoptions) | see below | Honeypot settings. `false` turns honeypots off. |
| `collectors` | `{ pointer?, keyboard?, touch?, scroll?, environment?, timing?: boolean }` | all `true` | Turn individual signal groups off. |
| `integrations` | `Integration[]` | `[]` | Frontend integrations. See [Frontend integrations](../guides/frontend-integrations.md). |
| `onResult` | `(result: ClientResult) => void` | none | Called for each result the server returns (`client`/`both` delivery only). |
| `awsContentHash` | `boolean` | `false` | Add an `x-amz-content-sha256` header to POST requests. **Required** for CloudFront → Lambda function URL with OAC. |
| `debug` | `boolean` | `false` | Log activity to the browser console. |

### `HoneypotOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `forms` | `string` or `false` | `'form[data-realhuman]'` | CSS selector for forms that get a hidden field. `false` = only forms passed to `attach()`. |
| `minFillMs` | `number` | `1500` | A form submitted faster than this after it was first shown counts as a time-trap hit. |
| `trapLink` | `boolean` | `false` | Add an invisible link that crawlers follow. |
| `agentCanary` | `boolean` | `false` | Add hidden instructions that AI agents may act on. |

### Script tag attributes

| Attribute | Option |
|---|---|
| `data-endpoint` | `endpoint` |
| `data-flush-after-ms` | `flushAfterMs` |
| `data-consent="false"` | `consent: false` |
| `data-aws-content-hash="true"` | `awsContentHash: true` |
| `data-debug="true"` | `debug: true` |

---

## Engine options

Accepted by every adapter: `createHandlers` (Vercel), `createLambdaHandler` (AWS), `createNodeHandler`
and `createWebHandler` (Node).

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `'algorithmic'` or a `jev(…)` engine | `'algorithmic'` | Who makes the decision. See [Jev engine](../guides/jev-engine.md). |
| `shadow` | `'algorithmic'` or a `jev(…)` engine | none | Run a second engine and store its answer in `record.shadow`. See [Shadow mode](../guides/shadow-mode.md). |
| `deliver` | `'server'` \| `'client'` \| `'both'` | `'server'` | Who receives results. See [Delivery modes](../guides/delivery-modes.md). |
| `clientFields` | `Array<'realHuman' \| 'label' \| 'verdict' \| 'kind' \| 'confidence'>` | `['realHuman', 'label', 'verdict', 'confidence']` | Fields the browser may receive. `sid` and `seq` are always included. Reason codes, evidence levels and `primaryReason` can never be exposed. |
| `onDecision` | `(record: DecisionRecord) => void \| Promise<void>` | none | Receives every decision. On Vercel and Node.js it runs after the response is sent; on AWS Lambda it finishes before the response is returned, because Lambda pauses as soon as it responds. A warning is logged at start-up if `deliver` includes `server` and this is missing. |
| `onDecisionTimeoutMs` | `number` | `10000` | Maximum time `onDecision` may run before it is abandoned (and logged). |
| `thresholds` | `{ human: number; bot: number }` | `{ human: 0.7, bot: 0.3 }` | Only used with a model engine such as Jev: a model probability at or below `bot` makes the label `bot`, and one at or above `human` turns `unverified` into `human`. Labels from the algorithmic engine come from evidence levels, not thresholds; see [Understanding results](../guides/understanding-results.md). |
| `secretEnv` | `string` | `'REALHUMAN_SECRET'` | **Name** of the environment variable holding the signing secret (at least 32 random bytes, base64). |
| `previousSecretEnv` | `string` | `'REALHUMAN_SECRET_PREVIOUS'` | **Name** of the variable holding the previous secret during [rotation](../operations/security.md#rotating-the-secret). Optional. |
| `nonceTtlMs` | `number` | `900000` (15 min) | How long a session nonce is valid. The SDK refreshes it automatically on long-lived pages. |
| `maxPayloadBytes` | `number` | `16384` | Larger request bodies are rejected with 413. |
| `allowedOrigins` | `string[]` | `[]` (same origin only) | Extra origins allowed to call the endpoint (CORS). Only needed if the endpoint is on a different domain. |
| `webBotAuth` | `{ agents?: string[]; authority?: string; fetch?: typeof fetch }` | `{ agents: [] }` (off) | Verify [Web Bot Auth](../glossary.md#web-bot-auth) signatures from the agent origins you list (for example `['https://chatgpt.com']`) and label them `verified_agent`. Only listed agents' key directories are ever fetched. Set `authority` to your public host name if a CDN rewrites the `Host` header (CloudFront → Lambda). |
| `ja4` | `{ browser?: string[]; nonBrowser?: string[] }` | `{}` | Exact JA4 values you know to be real browsers (never flagged) or non-browser clients (always gated). |
| `env` | `(name: string) => string \| undefined` | the adapter's default | How environment variables are read. Override for custom secret stores. |
| `logger` | `{ debug, info, warn, error }` | `console` | Where realHuman writes its own logs. |
| `debug` | `boolean` | `false` | Verbose logging, including reasons, on the server. |

---

## Vercel adapter

```ts
import { createHandlers, tagRequests } from '@realhuman/vercel';
```

### `createHandlers(options)`

Takes the [engine options](#engine-options) and returns `{ GET, POST }` route handlers. Mount them at
`app/api/realhuman/[action]/route.ts`.

Headers read automatically:

| Header | Set by | Used for |
|---|---|---|
| `x-vercel-ja4-digest` | Vercel | JA4 TLS fingerprint |
| `x-vercel-ip-timezone` | Vercel | IP time zone |
| `user-agent`, `accept-language` | Browser | Claimed browser |
| `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform` | Browser | Client Hints |
| `sec-fetch-site`, `sec-fetch-mode`, `sec-fetch-dest` | Browser | Fetch metadata |
| `signature`, `signature-input`, `signature-agent` | AI agents | Web Bot Auth |

`onDecision` and shadow engines run through `waitUntil`, after the response is sent.

### `tagRequests(options)`

Network-only labelling for every request, including clients that never run JavaScript. Use it in
`proxy.ts` (`middleware.ts` before Next.js 16). It never blocks or modifies responses.

| Option | Type | Default | Description |
|---|---|---|---|
| `onTag` | `(tag: EdgeTag) => void \| Promise<void>` | required | Receives `{ ts, path, realHuman, label, verdict, kind, primaryReason, reasons, server }` for each request. |
| `forwardHeader` | `string` or `false` | `'x-realhuman-edge'` | Adds a summary header to the request your app receives, so server-side logging can include it. |
| `sampleRate` | `number` | `1` | Fraction of requests to tag (0–1). |

---

## AWS adapter

```ts
import { createLambdaHandler } from '@realhuman/aws';
import { RealHumanEndpoint } from '@realhuman/aws/cdk';
```

### `createLambdaHandler(options)`

Takes the [engine options](#engine-options) plus:

| Option | Type | Default | Description |
|---|---|---|---|
| `secretArnEnv` | `string` | `'REALHUMAN_SECRET_ARN'` | **Name** of the variable holding a Secrets Manager ARN. If set, the secret is loaded from Secrets Manager on each container's first request and cached; `secretEnv` is then ignored. The value may be the secret itself or JSON `{"current": "…", "previous": "…"}` for rotation. If loading fails, sessions are reported `uncertain` and loading is retried after 60 s. |

Headers read automatically: `cloudfront-viewer-ja4-fingerprint`, `cloudfront-viewer-time-zone`, plus the
browser and Web Bot Auth headers listed under the [Vercel adapter](#createhandlersoptions).

### `RealHumanEndpoint` (CDK construct)

| Prop | Type | Default | Description |
|---|---|---|---|
| `distribution` | `cloudfront.Distribution` | required | The distribution to add the behaviour to. |
| `entry` | `string` | required | Path to your handler file (bundled with esbuild). |
| `secret` | `secretsmanager.ISecret` | required | The signing secret. The construct grants read access and sets `REALHUMAN_SECRET_ARN`. |
| `pathPattern` | `string` | `'/api/realhuman/*'` | Cache behaviour path. Must match the SDK's `endpoint`. |
| `memorySize` | `number` | `256` | Lambda memory (MB). |
| `timeout` | `Duration` | `Duration.seconds(5)` | Lambda timeout. Raise it if `onDecision` or Jev needs longer. |
| `environment` | `Record<string, string>` | `{}` | Extra environment variables (for example `AI_GATEWAY_API_KEY` references). |
| `headers` | `string[]` | 9 headers (see the [CloudFront quickstart](../getting-started/quickstart-cloudfront.md#step-3-option-b-set-it-up-by-hand)) | Headers forwarded by the origin request policy. Never include `Host`. |
| `webBotAuth` | `boolean` | `false` | Also forward `Signature`, `Signature-Input`, `Signature-Agent` (12 headers: needs a CloudFront quota increase). |
| `handler` | `string` | `'handler'` | Exported handler name in `entry`. |
| `runtime` | `lambda.Runtime` | Node.js 24 | Lambda runtime. |
| `architecture` | `lambda.Architecture` | `ARM_64` | Lambda architecture. |

**Lambda@Edge** is not supported: the handler accepts Lambda function URL events only.

---

## Node adapter

```ts
import { createNodeHandler, createWebHandler } from '@realhuman/node';
```

- **`createNodeHandler(options)`** returns `(req, res, next?)` middleware for Express, Connect and Node's `http` module.
- **`createWebHandler(options)`** returns `(request: Request) => Promise<Response>` for Hono, Fastify (with web adapters), Bun and Deno.

Both take the [engine options](#engine-options) plus:

| Option | Type | Default | Description |
|---|---|---|---|
| `ja4Header` | `string` | none | Header your TLS-terminating proxy sets with the JA4 fingerprint. **Only set this if the proxy always overwrites it.** |
| `timezoneHeader` | `string` | none | Header your proxy sets with the IP's time zone, if any. |
| `waitUntil` | `(promise: Promise<unknown>) => void` | none | Hook for platforms with a background-task API. Without it, background work runs in-process after the response is sent. |

Both handlers have a `drain()` method that resolves once in-flight background work (such as `onDecision`) has finished. Call it on shutdown.

---

## Jev engine

`jev(options)` from `@realhuman/jev`. Pass the result as `engine` or `shadow`. Full guide: [Jev engine](../guides/jev-engine.md).

| Option | Type | Default | Description |
|---|---|---|---|
| `provider` | `'vercel-ai-gateway'` \| `'openrouter'` \| `'typesafe'` \| `'ai-sdk'` \| `JevProvider` | required | Where Jev is called. |
| `apiKeyEnv` | `string` | per provider: `AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`, `TYPESAFE_AI_API_KEY` | **Name** of the environment variable holding the API key. Ignored for `'ai-sdk'`. For Vercel AI Gateway, falls back to `VERCEL_OIDC_TOKEN`. |
| `model` | `string` or AI SDK model | per provider: `typesafe-ai/jev`, `typesafe/jev-latest`, `jev-latest` | Model id. |
| `timeoutMs` | `number` | `800` | After this, the algorithmic engine answers (`engine: "algorithmic-fallback"`). |
| `failover` | `Array<{ provider, apiKeyEnv?, model?, baseUrl? }>` | `[]` | Providers to try, in order, on 402, 429, 5xx or network errors. All share `timeoutMs`. `'ai-sdk'` isn't allowed here. |
| `zeroDataRetention` | `boolean` | `true` | Ask Vercel AI Gateway (native or via `'ai-sdk'`) to route only to zero-data-retention providers. Not sent to OpenRouter or TypeSafe. |
| `fetch` | `typeof fetch` | global `fetch` | Override fetch, for proxies and tests. |
| `baseUrl` | `string` | provider default | Override the API base URL, for example to go through a corporate proxy. |
