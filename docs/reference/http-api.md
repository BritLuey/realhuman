# HTTP API

> [!NOTE]
> **Planned: milestone M2.** Request and response **bodies are available now** as schemas in
> `@realhuman/schema` (`InitResponseSchema`, `PayloadSchema`, `ClientResultSchema`).

The browser SDK and your server talk through three endpoints under a common prefix, the `endpoint`
option (default `/api/realhuman`). You never need to call these yourself; this page is for security reviews,
custom clients and debugging.

All responses carry `Cache-Control: no-store`. Endpoints are same-origin only unless you configure
`allowedOrigins`.

## `GET {endpoint}/init`

Starts a session. Returns a fresh session id and a signed nonce.

**Response `200`:**

```json
{
  "v": 1,
  "sid": "k3J9x0aQ2mW8pL5rT7yB",
  "nonce": "v1.eyJzaWQiOiJrM0o5eDBhUTJtVzhwTDVyVDd5QiIsImlhdCI6MTc1OTMyMDAwMDAwMH0.c2lnbmF0dXJl",
  "expiresAt": 1759320900000
}
```

| Field | Meaning |
|---|---|
| `v` | Schema version (`1`). |
| `sid` | Random id for this page load. 16–64 characters from `A–Z a–z 0–9 _ -`. |
| `nonce` | Opaque signed token. It is bound to this `sid` and to a hash of the client's JA4 fingerprint and user agent, so it can't be reused by a different client. |
| `expiresAt` | Unix time (ms) after which the nonce is rejected. The SDK fetches a new one before then. |

## `POST {endpoint}/score`

Sends an update.

**Request headers:** `Content-Type: application/json`. With `awsContentHash: true` the SDK also sends
`x-amz-content-sha256: <hex SHA-256 of the body>`.

**Request body:** a [Payload](data-formats.md#payload). Unknown fields are ignored. Maximum size is
`maxPayloadBytes` (default 16,384 bytes).

**Responses:**

| Status | When | Body |
|---|---|---|
| `204 No Content` | Delivery mode `server` | none |
| `200 OK` | Delivery mode `client` or `both` | A [ClientResult](data-formats.md#client-result) |
| `400 Bad Request` | Body isn't valid JSON or doesn't match the schema | `{ "error": "invalid_payload" }` |
| `413 Payload Too Large` | Body exceeds `maxPayloadBytes` | `{ "error": "payload_too_large" }` |
| `405 Method Not Allowed` | Wrong method | none |

A bad or replayed **nonce** is not an HTTP error. The request is accepted and scored as a bot (reason
codes `nonce_invalid`, `nonce_expired` or `nonce_replayed`), so automated clients get no hint about
what went wrong.

The endpoint **fails open**: if scoring or `onDecision` fails internally, the error is logged and the client
still receives `204`, or a result with `verdict: "uncertain"`. It never returns 5xx because of scoring.

## `GET {endpoint}/t`

The **trap link** target, used only when `honeypot.trapLink` is on.

**Query:** `?s=<sid>&n=<nonce>`

**Response:** always `204 No Content`.

**Effect:** if the nonce is genuine, the engine emits a decision for that `sid` with verdict `bot`, reason
`honeypot_trap_followed` and `seq: 1000`, so it takes precedence over every regular update.

> [!TIP]
> Add `Disallow: /api/realhuman/` to your `robots.txt` so well-behaved search engine crawlers don't follow
> the trap.

## Headers the server trusts

Only headers set by your CDN or proxy count as network evidence. See
[Configuration](configuration.md#vercel-adapter) for the exact list per adapter, and
[Security: trusted headers](../operations/security.md#trusted-headers) for why it matters.
