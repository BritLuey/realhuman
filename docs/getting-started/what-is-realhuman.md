# What is realHuman?

## The problem

A large share of website traffic comes from automated programs: scrapers, crawlers, uptime monitors,
fraud tools, test scripts and, increasingly, AI agents browsing on someone's behalf. Most don't identify
themselves. They load your pages, run your analytics tags and end up counted as "visitors".

That skews:

- **Traffic numbers**, which look higher than real interest.
- **Conversion rates**, which look lower because bots never buy.
- **A/B tests**, where bots split unevenly and hide real effects.
- **Funnels and heatmaps**, which get filled with behaviour no person produced.

## What realHuman does

realHuman answers two questions about each page load, "did we see a bot?" and "did we see a person?", and
combines the answers into a **label**:

| Label | Meaning |
|---|---|
| `human` | Real interaction was seen, and no meaningful sign of automation |
| `unverified` | No evidence either way, typically someone who opened the page and left |
| `suspicious` | Some signs of automation, but nothing conclusive |
| `bot` | Strong or conclusive signs of automation |
| `verified_agent` | An AI agent or crawler that proved who it is |

Each decision also includes the **main reason** for its label (for example "Natural mouse movement"), every
**reason code** behind it, and a **score** from 0 to 1 for ranking sessions.

You use the label to **filter your data**, for example "only count page views where `label <> 'bot'`".
[Understanding results](../guides/understanding-results.md) explains exactly how each label is decided.

> [!IMPORTANT]
> realHuman **never blocks anyone**. The visitor's experience is the same whatever their label.
> The score is for your data and reporting only.

## How it decides, in plain English

People and programs behave differently, even when a program pretends to be a person:

- **People move a mouse in curves**, speeding up and slowing down. Scripts tend to move in straight lines or jump straight to a button.
- **People type unevenly.** Scripts often type with perfectly even gaps.
- **Remote-controlled browsers leave traces**, such as a flag that says "I'm being automated", or features that don't match the browser they claim to be.
- **The network connection has a fingerprint.** When a program claims to be Chrome but its secure connection looks like a Python script's, that's a strong clue. This fingerprint is called [JA4](../glossary.md#ja4).
- **Invisible traps.** Real people can't see hidden "honeypot" form fields, so they never fill them in. Bots often do.

realHuman gathers many small clues like these and weighs them together. No single clue decides the result
unless it's conclusive, such as a filled-in honeypot.

## What realHuman is not

- **Not a firewall or CAPTCHA.** It doesn't stop traffic. If you need to block bots, use a web application firewall (WAF) as well.
- **Not a tracking tool.** It stores nothing on the visitor's device and creates no ID that follows people between visits. Mouse coordinates and key presses never leave the browser, only summaries of them. See [Privacy & compliance](../operations/privacy-and-compliance.md).
- **Not a hosted service.** It runs in your own Vercel project, AWS account or Node.js server. No data goes to us.
- **Not perfect.** A well-funded attacker with real devices can look human. realHuman catches the large majority of everyday automation and makes the rest expensive. Treat labels as strong evidence, not proof.

## The parts

| Part | Where it runs | What it does |
|---|---|---|
| **Browser SDK** (`@realhuman/client`) | In your web pages | Collects signals and sends a summary to your server |
| **Engine** (`@realhuman/engine`) | On your server or edge | Checks the session token, adds network evidence, works out the label |
| **Adapter** (`@realhuman/vercel`, `@realhuman/aws`, `@realhuman/node`) | Wraps the engine | Connects the engine to your hosting platform and reads trusted network headers |

## Key terms

You'll see these words throughout the docs. The [glossary](../glossary.md) has the full list.

| Term | Meaning |
|---|---|
| **sid** | A random ID for one page load. It is not stored on the device and is useless after the visit. |
| **seq** | The update number within a page load: `0` for the first, then `1`, `2`… The highest number is the latest. |
| **Decision record** | The full result your backend receives for each update, including reasons. |
| **Delivery mode** | Whether the result goes to your backend, the browser, or both. |
| **Label** | The field to filter on: `human`, `unverified`, `suspicious`, `bot` or `verified_agent`. |

## Next

Read [How it works](how-it-works.md), or go straight to a quickstart:
[Vercel](quickstart-vercel.md) · [AWS CloudFront](quickstart-cloudfront.md) · [Node.js](quickstart-node.md).
