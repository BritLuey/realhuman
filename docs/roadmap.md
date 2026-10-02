# Roadmap

| Milestone | What shipped | Packages | Status |
|---|---|---|---|
| **M0: Foundations** | Monorepo, CI, release pipeline, data formats and reason codes, documentation | `@realhuman/schema` | ✅ Done |
| **M1: Browser SDK** | Signal collectors, honeypots, sending, consent, script-tag build | `@realhuman/client` | ✅ Done |
| **M2: Algorithmic engine** | Nonces, gates, evidence scoring, delivery modes, `onDecision`, Web Bot Auth | `@realhuman/engine` | ✅ Done |
| **M3: Vercel adapter** | Route handlers, JA4 from Vercel headers, edge tagging | `@realhuman/vercel` | ✅ Done |
| **M4: AWS adapter** | Lambda handler, Secrets Manager support, CDK construct | `@realhuman/aws` | ✅ Done |
| **M5: Jev engine** | Jev via Vercel AI Gateway, OpenRouter, TypeSafe and the AI SDK; failover; shadow mode | `@realhuman/jev` | ✅ Done |
| **M6: Frontend integrations** | New Relic, Datadog RUM, GA4, GTM, Segment, PostHog; React provider | `@realhuman/client`, `@realhuman/react` | ✅ Done |
| **M7: Calibration tooling** | Bot lab, re-scoring CLI, Node adapter, demo site | `@realhuman/node`, `tools/bot-lab`, `apps/demo` | ✅ Done |

## Before 1.0

Three things stand between the current code and a 1.0 release:

1. **Calibrate against real human traffic.** The bot lab currently scores all 9 of its automation scenarios as
   bots, but it can't measure *false positives*: how often real people are mistaken for bots. That needs real
   sessions. Deploy with [shadow mode](guides/shadow-mode.md) or in `server` delivery mode, review the
   `uncertain` and `bot` sessions from known-good traffic (staff, logged-in customers), and tune `WEIGHTS` in
   `packages/engine/src/analysis.ts`. Then publish the false-positive rate at the default thresholds.
2. **Verify in production environments.**
   - Confirm Vercel's `x-vercel-ja4-digest` and CloudFront's `CloudFront-Viewer-JA4-Fingerprint` values parse
     as standard JA4.
   - Deploy the CDK construct to a real AWS account; its permissions are checked at synth time only.
   - Confirm OpenRouter's Jev evaluation endpoint, which is currently assumed.
3. **Publish to npm.** Claim the `@realhuman` npm scope, set up trusted publishing, and merge the first
   "Version Packages" pull request.

## Ideas for later

- Expand the bot lab: more stealth frameworks, anti-detect browsers, mobile emulation.
- A Cloudflare Workers adapter (the engine already runs there; it needs Bot Management for JA4).
- Published JSON Schema files for warehouse teams.

## Not planned

These are deliberate non-goals:

- **Blocking or challenging visitors.** Use a WAF for that.
- **Persistent device identification.** It conflicts with realHuman's privacy design.
- **A hosted service.** realHuman runs in your infrastructure.

Have a request? [Open a feature request](https://github.com/your-org/realhuman/issues/new/choose).
