# realHuman bot lab

Runs common automation techniques against the [demo site](../../apps/demo) and reports how realHuman scores
each one. Use it to check that changes to the SDK or engine still catch bots.

```bash
pnpm install
pnpm build
pnpm --filter @realhuman/bot-lab lab
```

It drives the Chrome installed on your machine through `playwright-core`, so no browser download is needed.
Use Edge instead with `BOT_LAB_BROWSER=msedge`. Run a subset with `-- --only=browser`.

Results are printed and saved to `results/latest.json`.

## Scenarios

| Scenario | Technique |
|---|---|
| python-requests | Honest HTTP library, non-browser TLS fingerprint |
| Scraper posing as Chrome | Chrome user agent, forged "human" payload, no fetch metadata, HTTP/1.1-only TLS |
| Replayed nonce | Session token issued to one client, used by another |
| Headless, straight-line mouse | Headless Chrome with `AutomationControlled` disabled, scripted mouse path |
| `navigator.webdriver` left on | Automation flag visible |
| Synthetic events | Pointer events and clicks dispatched from JavaScript |
| Form filler | Fills every input, including honeypots |
| Stealth-style patches | User agent and navigator properties patched in JavaScript |
| Playwright leftovers | `__playwright*` globals in the page |

## What the lab can't tell you

**False positives.** Measuring how often real people are mistaken for bots needs real human sessions,
and those can't be automated. Run the demo and use it yourself, and use [shadow mode](../../docs/guides/shadow-mode.md)
on real traffic, before relying on thresholds.

**JA4 in production.** Locally there's no CDN, so scenarios simulate the JA4 header a CDN would add.
