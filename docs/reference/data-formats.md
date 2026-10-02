# Data formats

> [!NOTE]
> **Available now** in [`@realhuman/schema`](../../packages/schema). Every format on this page is
> defined there as a [Valibot](https://valibot.dev) schema with matching TypeScript types.

realHuman uses four formats:

| Format | Direction | Schema |
|---|---|---|
| [Init response](#init-response) | Server → browser | `InitResponseSchema` |
| [Payload](#payload) | Browser → server | `PayloadSchema` |
| [Client result](#client-result) | Server → browser (client/both delivery only) | `ClientResultSchema` |
| [Decision record](#decision-record) | Server → your backend (`onDecision`) | `DecisionRecordSchema` |

## Using the schemas

```bash
npm install @realhuman/schema
```

```ts
import { parseDecisionRecord, type DecisionRecord } from '@realhuman/schema';

const result = parseDecisionRecord(untrustedJson);
if (result.success) {
  const record: DecisionRecord = result.output;
} else {
  console.warn(result.issues); // e.g. ["realHuman: Invalid value: Expected <=1 but received 1.4"]
}
```

`parsePayload`, `parseInitResponse`, `parseClientResult` and `parseDecisionRecord` **never throw**, and
they **drop unknown fields**.

## Versioning

Every format carries `"v": 1`. The version changes only when a change would break existing consumers.
Adding new optional fields doesn't change it, so **always ignore fields you don't recognise**. See
[Versioning & support](../operations/versioning-and-support.md).

---

## Init response

Returned by `GET {endpoint}/init`. See [HTTP API](http-api.md#get-endpointinit).

| Field | Type | Description |
|---|---|---|
| `v` | `1` | Schema version |
| `sid` | string | Session id for this page load (16–64 chars, `A–Z a–z 0–9 _ -`) |
| `nonce` | string | Signed session token (16–512 chars) |
| `expiresAt` | integer | Unix time in ms when the nonce expires |

---

## Payload

Sent by the browser to `POST {endpoint}/score`.

| Field | Type | Description |
|---|---|---|
| `v` | `1` | Schema version |
| `sid` | string | Session id from the init response |
| `seq` | integer 0–1000 | Update number: `0` first, then increasing |
| `final` | boolean | `true` when sent while the page closes |
| `nonce` | string | Nonce from the init response |
| `elapsedMs` | number | Monotonic ms since the SDK started |
| `wallElapsedMs` | number | Wall-clock ms since the SDK started |
| `context` | object | Your join keys: up to 10 keys (1–64 chars, `A–Z a–z 0–9 _ . -`), values up to 256 chars |
| `signals` | [Signals](#signals) | What was observed |

### Signals

Each group is `null` when its collector is off or unsupported. Field-by-field explanations, and the
privacy treatment of each, are in [Signals](signals.md).

| Group | Always present? | Contents |
|---|---|---|
| `env` | yes | Automation markers, headless traits, consistency checks, time zone |
| `pointer` | nullable | Mouse/pen movement statistics and click patterns |
| `keyboard` | nullable | Typing rhythm statistics and key-class counts |
| `touch` | nullable | Touch contact statistics |
| `scroll` | nullable | Scroll and wheel statistics |
| `timing` | yes | Time to first interaction, frame and event-loop timing, clock drift |
| `honeypot` | nullable | Honeypot and trap results |

---

## Client result

Returned by `POST {endpoint}/score` in `client` or `both` delivery mode. Only the fields listed in
`clientFields` are included.

| Field | Type | Always present | Description |
|---|---|---|---|
| `v` | `1` | yes | Schema version |
| `sid` | string | yes | Session id |
| `seq` | integer | yes | Which update this answers |
| `realHuman` | number 0–1 | if allowed | Score |
| `verdict` | [Verdict](#verdict) | if allowed | Headline outcome |
| `kind` | [Kind](#kind) | if allowed | What's driving the session |
| `confidence` | number 0–1 | if allowed | How much evidence there was |

---

## Decision record

Passed to `onDecision` for every update. **This is the source of truth for filtering.**

| Field | Type | Description |
|---|---|---|
| `v` | `1` | Schema version |
| `sid` | string | Session id. Use it as the primary key. |
| `seq` | integer | Update number. **Keep the highest per `sid`.** |
| `final` | boolean | `true` if this update was sent as the page closed. Don't rely on it arriving. |
| `ts` | ISO 8601 string | When the server decided |
| `realHuman` | number 0–1 | The score. Higher means more likely human. |
| `verdict` | [Verdict](#verdict) | Headline outcome, from `realHuman` and your `thresholds` |
| `kind` | [Kind](#kind) | What's driving the session |
| `confidence` | number 0–1 | How much evidence was available. Low early in a visit, or with no interaction. |
| `reasons` | string[] | [Reason codes](reason-codes.md) explaining the decision |
| `engine` | `algorithmic` \| `jev` \| `algorithmic-fallback` \| `gate` | Who decided. `gate` means a conclusive check settled it. |
| `engineVersion` | string | Version of the engine package, for re-scoring and audits |
| `model` | string, optional | Model id (Jev only) |
| `provider` | string, optional | Provider used (Jev only) |
| `questionsVersion` | string, optional | Version of the question wording (Jev only) |
| `shadow` | object, optional | The shadow engine's `{ engine, realHuman, verdict, reasons }`. See [Shadow mode](../guides/shadow-mode.md). |
| `server` | [Server facts](#server-facts) | Network evidence read at the edge |
| `signals` | [Signals](#signals) or `null` | What the browser observed. `null` when the SDK never ran (`kind: "no_js"`). |
| `context` | object | Your join keys, copied from the payload |

### Server facts

| Field | Type | Description |
|---|---|---|
| `ja4` | string \| null | JA4 TLS fingerprint from your CDN, e.g. `t13d1516h2_8daaf6152771_02713d6af862` |
| `uaFamily` | string \| null | Browser family parsed from the user agent, e.g. `chrome`. The raw string is never stored. |
| `uaMajor` | integer \| null | Browser major version |
| `platform` | string \| null | Operating system family, e.g. `windows` |
| `timezoneMatch` | boolean \| null | Does the browser's time zone match the IP's? `null` if either is unknown. |
| `secFetchPresent` | boolean | Were fetch-metadata headers present? |
| `clientHintsPresent` | boolean | Were User-Agent Client Hints present? |
| `verifiedAgent` | string \| null | Agent name from a valid Web Bot Auth signature |

### Verdict

| Value | Meaning |
|---|---|
| `human` | `realHuman` ≥ `thresholds.human` (default 0.7) |
| `bot` | `realHuman` ≤ `thresholds.bot` (default 0.3) |
| `verified_agent` | An AI agent or crawler that proved its identity with Web Bot Auth |
| `uncertain` | In between, or not enough evidence yet |

### Kind

| Value | Meaning |
|---|---|
| `human` | A person in an ordinary browser |
| `privacy_browser` | A person in a privacy-hardened browser (Brave, Tor, Firefox with resistFingerprinting…) |
| `automation` | A browser automation framework (Playwright, Puppeteer, Selenium…) |
| `scraper` | A headless browser or non-browser HTTP client |
| `ai_agent` | An LLM-driven browser agent that did not identify itself |
| `verified_agent` | An agent that identified itself with Web Bot Auth |
| `no_js` | A client that never ran the SDK (edge tagging only) |
| `unknown` | Not enough evidence to say |

### Example

```json
{
  "v": 1,
  "sid": "k3J9x0aQ2mW8pL5rT7yB",
  "seq": 1,
  "final": true,
  "ts": "2026-10-01T12:00:00.000Z",
  "realHuman": 0.91,
  "verdict": "human",
  "kind": "human",
  "confidence": 0.74,
  "reasons": ["pointer_natural", "scroll_natural"],
  "engine": "algorithmic",
  "engineVersion": "1.0.0",
  "server": {
    "ja4": "t13d1516h2_8daaf6152771_02713d6af862",
    "uaFamily": "chrome",
    "uaMajor": 141,
    "platform": "windows",
    "timezoneMatch": true,
    "secFetchPresent": true,
    "clientHintsPresent": true,
    "verifiedAgent": null
  },
  "signals": { "env": { "...": "..." }, "pointer": { "...": "..." }, "keyboard": null, "touch": null, "scroll": { "...": "..." }, "timing": { "...": "..." }, "honeypot": { "...": "..." } },
  "context": { "gaClientId": "1234567890.1700000000" }
}
```
