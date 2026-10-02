# realHuman documentation

Welcome. If you are new, read the pages in the **Start here** section in order. They take about
15 minutes in total.

Each page that describes an unreleased feature has a note at the top naming its [roadmap](roadmap.md)
milestone.

## Start here

| | Page | You'll learn |
|---|---|---|
| 1 | [What is realHuman?](getting-started/what-is-realhuman.md) | What problem it solves, what it doesn't do, key terms |
| 2 | [How it works](getting-started/how-it-works.md) | The journey from page load to decision record, step by step |
| 3 | Pick one quickstart: [Vercel](getting-started/quickstart-vercel.md) · [AWS CloudFront](getting-started/quickstart-cloudfront.md) · [Node.js](getting-started/quickstart-node.md) | A working setup |

## Guides: doing specific things

| Guide | Use it when you want to… |
|---|---|
| [Browser SDK](guides/browser-sdk.md) | Install and configure the script that runs in the browser |
| [Honeypots](guides/honeypots.md) | Add invisible bot traps to your forms |
| [Delivery modes](guides/delivery-modes.md) | Choose who receives the result: backend, browser, or both |
| [Ingesting decisions](guides/ingesting-decisions.md) | Store decision records in a database or warehouse |
| [Filtering your data](guides/filtering-your-data.md) | Remove bot traffic from analytics, with example SQL |
| [Frontend integrations](guides/frontend-integrations.md) | Send the score to New Relic, Datadog, GA4, Segment, PostHog or GTM |
| [Jev engine](guides/jev-engine.md) | Let TypeSafe AI's Jev model make the decision instead of the built-in rules |
| [Shadow mode](guides/shadow-mode.md) | Compare two engines safely before switching |

## Reference: exact details

| Reference | Contents |
|---|---|
| [Configuration](reference/configuration.md) | Every option for the browser SDK, engine and adapters |
| [HTTP API](reference/http-api.md) | The two endpoints, their requests, responses and status codes |
| [Data formats](reference/data-formats.md) | Payload, client result and decision record, field by field |
| [Signals](reference/signals.md) | Every signal collected, why, and how privacy is protected |
| [Reason codes](reference/reason-codes.md) | What each reason code in a decision record means |
| [Environment variables](reference/environment-variables.md) | Every environment variable realHuman reads |

## Operations: running it in production

| Page | For |
|---|---|
| [Security](operations/security.md) | Security reviewers and platform teams |
| [Privacy & compliance](operations/privacy-and-compliance.md) | Privacy, legal and data-protection teams |
| [Performance](operations/performance.md) | Front-end and SRE teams |
| [Troubleshooting](operations/troubleshooting.md) | Anyone whose setup isn't working |
| [Versioning & support](operations/versioning-and-support.md) | Teams planning upgrades and support |

## Also useful

- [Glossary](glossary.md): plain-English definitions of every technical term used in these docs
- [Roadmap](roadmap.md): what's available now and what's coming
