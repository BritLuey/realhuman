# Roadmap

realHuman is built in milestones. Each milestone ships as package releases on npm, with its docs updated
from "Planned" to "Available".

| Milestone | What ships | Packages | Status |
|---|---|---|---|
| **M0: Foundations** | Monorepo, CI, release pipeline, data formats and reason codes, documentation | `@realhuman/schema` | ✅ **Done** |
| **M1: Browser SDK** | Signal collectors, honeypots, sending, consent, script-tag build | `@realhuman/client` | Next |
| **M2: Algorithmic engine** | Nonces, gates, evidence scoring, delivery modes, `onDecision` | `@realhuman/engine` | Planned |
| **M3: Vercel adapter** | Route handlers, JA4 from Vercel headers, edge tagging, Next.js example app | `@realhuman/vercel` | Planned |
| **M4: AWS adapter** | Lambda handler, Secrets Manager support, CDK construct, example stack | `@realhuman/aws` | Planned |
| **M5: Jev engine** | Jev via Vercel AI Gateway, OpenRouter and TypeSafe; failover; shadow mode | `@realhuman/jev` | Planned |
| **M6: Frontend integrations** | New Relic, Datadog RUM, GA4, GTM, Segment, PostHog; React provider | `@realhuman/client`, `@realhuman/react` | Planned |
| **M7: Calibration & 1.0** | Bot test lab, published accuracy figures, re-scoring tool, Node adapter, 1.0 release | `@realhuman/node`, tooling | Planned |

## M7 in more detail

Before 1.0, the scoring is calibrated and its accuracy published:

- **Bot lab:** an automated harness that runs common automation stacks (Playwright, Puppeteer with stealth
  plugins, Selenium, undetected/patched Chromium builds, anti-detect browsers, plain HTTP clients) against a
  test site, alongside real human sessions.
- **Published numbers:** false-positive and detection rates at the default thresholds, re-measured for every
  release that changes scoring.
- **Re-scoring tool:** re-scores stored decision records with a newer engine, so historical data benefits
  from improvements.

## Not planned

These are deliberate non-goals:

- **Blocking or challenging visitors.** Use a WAF for that.
- **Persistent device identification.** It conflicts with realHuman's privacy design.
- **A hosted service.** realHuman runs in your infrastructure.

Have a request? [Open a feature request](https://github.com/your-org/realhuman/issues/new/choose).
