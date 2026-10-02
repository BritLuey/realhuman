# realHuman bot lab

Runs automation techniques against a realHuman demo and reports how each is scored. Every session is labelled
(`truth=bot`, `scenario`, `run`), so the results feed straight into the [evaluation report](../eval).

```bash
pnpm install
pnpm build

# Against a local demo (started and stopped for you)
pnpm --filter @realhuman/bot-lab lab

# Against your deployed Vercel demo, 20 sessions per scenario
pnpm --filter @realhuman/bot-lab lab -- --target=https://your-demo.vercel.app --run=pilot-1 --repeat=20
```

It drives the Chrome installed on your machine through `playwright-core`, so there's nothing to download. Use
Edge with `BOT_LAB_BROWSER=msedge`.

| Option | Meaning |
|---|---|
| `--target=<url>` | Test a deployed demo instead of the local one. Real JA4 fingerprints come from Vercel's edge |
| `--run=<id>` | Run id stored with every session (default: a timestamp) |
| `--repeat=<n>` | Sessions per scenario |
| `--only=<text>` | Only scenarios whose name or slug contains this |

Results go to `results/<run>.json`. For local runs, the labelled decision records go to `results/<run>.ndjson`
too, so you can run `pnpm --filter @realhuman/eval report -- ../bot-lab/results/<run>.ndjson`.

## Scenarios

| Tier | Slug | Technique |
|---|---|---|
| Commodity | `http-python-requests` | Honest HTTP library |
| Commodity | `http-chrome-impostor` | Chrome user agent, forged "human" payload, no fetch metadata |
| Commodity | `http-replayed-nonce` | Session token issued to one client, used by another |
| Commodity | `headless-straight-mouse` | Headless Chrome, scripted straight-line mouse |
| Commodity | `headless-webdriver` | Automation flag visible |
| Commodity | `synthetic-events` | Events dispatched from JavaScript |
| Commodity | `form-filler` | Fills every input, honeypots included |
| Commodity | `playwright-leftovers` | `__playwright*` globals in the page |
| Stealth | `stealth-patches` | User agent and navigator properties patched in JavaScript |
| Human-like | `humanlike-headless` | Curved mouse paths and realistic typing, headless user agent |
| Human-like | `humanlike-advanced` | The same, with a consistent non-headless user agent |

## Latest local results

5 sessions per scenario (`--repeat=5`): **50 of 55 labelled `bot`**. Every commodity and stealth scenario was
labelled `bot` 5 of 5, and so was `humanlike-headless`. `humanlike-advanced` was labelled `suspicious` 5 of 5,
from its headless traits (`no_browser_ui`, `viewport_is_screen`); none passed as `human` or `unverified`. So the
standard filter (`label <> 'bot'`) removes 50 of the 55 sessions, and the strict filter removes all 55.

## What the lab can't tell you

How often real people are wrongly flagged. That needs labelled human sessions; see
[Proving it works](../../docs/guides/evaluation.md).
