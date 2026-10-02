# Security

This page is for security reviewers and platform teams. To report a vulnerability, follow
[SECURITY.md](../../SECURITY.md); please don't open a public issue.

> [!NOTE]
> The controls below describe the intended design (milestones M1–M5). Each will be covered by automated
> tests when it ships.

## What realHuman protects, and what it doesn't

realHuman is an **analytics labelling** tool. It never blocks traffic, so a successful attack on it can at
worst **mislabel data**. It can't grant access to anything. Its security goals are:

1. **Labels are hard to forge.** A bot shouldn't be able to make itself look human cheaply.
2. **Labels can't be planted on other sessions.** Nobody should be able to mark someone else's session as a bot.
3. **realHuman never harms the host site.** No crashes, no slowdowns, no new data exposure.

Out of scope: an attacker using real devices driven by real people (click farms), and attackers who can
read your server's memory or environment.

## Threat model

| Threat | Mitigation |
|---|---|
| **Forged network evidence.** The attacker sends their own `x-vercel-ja4-digest` or `CloudFront-Viewer-JA4-Fingerprint` header. | Only CDN-set headers are trusted; Vercel and CloudFront overwrite them. On AWS, the Lambda function URL accepts only CloudFront-signed requests (OAC). For self-hosting, `ja4Header` must be a header your proxy overwrites. See [trusted headers](#trusted-headers). |
| **Replay.** The attacker records a genuine human payload and replays it from a bot. | Each nonce is signed (HMAC-SHA-256) and bound to its `sid` and to a hash of the client's JA4 + user agent, and expires after `nonceTtlMs`. Replays from a different client trigger `nonce_replayed`. |
| **Fabricated signals.** The bot sends a payload that looks human. | Payloads are treated as untrusted claims and cross-checked against evidence the client doesn't control (TLS fingerprint, headers, timing measured on the server). Inconsistencies are penalised. Reason codes are never revealed, so attackers get no feedback. This raises cost; it can't make forgery impossible. |
| **Clock manipulation.** The bot fast-forwards time to look patient. | Server-measured time since nonce issue is compared with client-reported elapsed time (`too_fast`). |
| **Probing.** The attacker experiments to learn the scoring. | In `server` delivery mode responses are always `204`. Invalid nonces are scored, not rejected, so there's no error signal. |
| **Planting bot labels on other users.** | Session ids are random (≥ 96 bits) and never shown in URLs except the optional trap link, which requires a valid nonce for that `sid`. |
| **Denial of service against the endpoint.** | Payloads are capped (`maxPayloadBytes`, default 16 KB). Validation is linear-time with no regex backtracking risk. Put the endpoint behind your existing WAF and rate limiting (Vercel Firewall, AWS WAF). |
| **Tampering with browser-delivered scores.** | Documented as untrusted. The backend record is the source of truth. See [Delivery modes](../guides/delivery-modes.md#a-word-on-trust). |
| **Secret leakage.** | Secrets are read from environment variables or Secrets Manager by name, never from code. Rotation is supported without downtime. Secrets are never logged. |
| **Supply-chain compromise.** | Minimal dependencies (the schema package depends only on `valibot`), npm provenance on every release, lockfile-pinned CI. See [Versioning & support](versioning-and-support.md#supply-chain). |
| **Breaking the host page.** | The SDK never throws into host code, uses passive listeners only, and degrades gracefully when blocked. |

## Trusted headers

realHuman's strongest evidence comes from headers set by your CDN. They can only be trusted if **every
request reaches realHuman through that CDN**:

| Platform | What makes it safe | What you must do |
|---|---|---|
| **Vercel** | Vercel sets `x-vercel-*` headers at its edge and overwrites anything the client sent | Nothing |
| **CloudFront + Lambda function URL** | OAC: the function URL rejects any request not signed by your distribution | Use OAC (the CDK construct does this). Never set the function URL's auth type to `NONE`. |
| **Self-hosted** | Your proxy sets the header | Configure the proxy to **overwrite** (not append to) the JA4 header, and make sure Node.js is not reachable except through the proxy |

## Secrets

- Use at least **32 random bytes**. realHuman refuses shorter secrets.
- Use the **same secret on every instance** of your deployment.
- Keep it out of source control and browser bundles.

### Rotating the secret

1. Copy the current value of `REALHUMAN_SECRET` into `REALHUMAN_SECRET_PREVIOUS`.
2. Set `REALHUMAN_SECRET` to a new value and deploy.
3. Wait at least `nonceTtlMs` (default 15 minutes). New nonces use the new secret; old ones still verify.
4. Remove `REALHUMAN_SECRET_PREVIOUS` and deploy again.

On AWS with Secrets Manager, use the secret's built-in rotation with the same two-value approach.

## Content Security Policy

The SDK needs `connect-src 'self'` (or your endpoint's origin). For the Worker consistency check it also
needs `worker-src blob:`; if that's blocked, the check is skipped. No `unsafe-eval` or `unsafe-inline` is
needed.

## Logging

realHuman's own logs never contain secrets, nonces, API keys or raw user-agent strings. `debug: true`
adds reason codes and timings, which is safe for production but noisy.
