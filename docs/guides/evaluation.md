# Proving it works: the evaluation method

This guide shows how to measure how well realHuman works, and how to back that up with numbers you can show
other people.

## What "works" means

Two numbers matter, and you need both:

| Number | Question it answers | Good looks like |
|---|---|---|
| **Detection rate** | Of sessions you *know* are bots, how many does your filter remove? | High, broken down by bot type |
| **False-positive rate** | Of sessions you *know* are human, how many does your filter wrongly remove? | Very low, in every browser |

A third number helps with tuning: the **confirmed-human rate**, meaning how many real people were labelled
`human` rather than `unverified`.

Any detector can score 100% on one of these by giving up the other: flag everyone, or flag no one. That's
why a bot lab run on its own proves nothing about real people. You need labelled human sessions too.

## The tools

| Tool | Job |
|---|---|
| [Vercel demo](../../apps/vercel-demo) | A hosted page that scores visits and stores labelled sessions |
| [Bot lab](../../tools/bot-lab) | Sends labelled bot sessions using 11 automation techniques |
| [Evaluation report](../../tools/eval) | Turns labelled sessions into rates, confidence intervals, a ROC curve and per-scenario tables |
| [`realhuman-rescore`](ingesting-decisions.md#why-keep-the-full-record) | Re-scores stored sessions with changed weights, so you can test a tuning change before deploying it |

## Step 1: Deploy the demo

Follow the [Vercel demo README](../../apps/vercel-demo/README.md), including the Upstash storage step and
`DEMO_ADMIN_TOKEN`. Testing on Vercel matters: only a real edge gives you the JA4 TLS fingerprint, one of the
strongest signals.

## Step 2: Decide how many sessions you need

Pick a **run id** for this test, such as `pilot-1`. Every link and bot run uses it, so the report can keep test
runs apart.

**Humans.** The false-positive rate you can claim depends on how many human sessions you collect:

| Human sessions with **zero** flagged as bots | You can claim, with 95% confidence, a false-positive rate below… |
|---|---|
| 60 | 5% |
| 150 | 2% |
| 300 | 1% |
| 600 | 0.5% |

(This is the "rule of three": with zero failures in *n* tries, the 95% upper bound is about 3 ÷ *n*.) If some
humans *are* flagged, the report gives a Wilson confidence interval instead.

**Bots.** With 20–30 sessions per bot scenario, each scenario's detection rate is accurate to roughly ±10–15
percentage points. `--repeat=20` in the bot lab does this.

## Step 3: Collect human sessions

Send testers this link (with your demo address and run id):

```
https://<your-demo>/?truth=human&run=pilot-1
```

Optionally add `&participant=p01` and so on, so you can follow up on odd results.

**What to tell testers** (copy and adapt):

> Please open this link and use the page as you normally would for about 30 seconds: read it, scroll, and type
> something into the form. Then close the tab. Please do this two or three times, on different devices if you
> can. The page records how you interact (for example, how your mouse moves), never what you type. Data is
> kept for 30 days for testing.

**Cover the visitors you actually have.** False positives hide in the less common setups, so aim for a mix:

- [ ] Desktop with a mouse, and laptop with a trackpad
- [ ] iPhone (Safari) and Android (Chrome)
- [ ] The link opened inside an app (LinkedIn, Instagram, Slack): in-app browsers behave differently
- [ ] Keyboard-only navigation, and a screen reader (NVDA, VoiceOver)
- [ ] Privacy browsers: Brave, Firefox with strict tracking protection, Tor Browser
- [ ] A corporate network or VPN
- [ ] An older or slower device
- [ ] Someone who just glances at the page and leaves (short sessions are real too)
- [ ] Private or incognito windows, in each main browser
- [ ] Privacy extensions: an ad blocker such as uBlock Origin, and a fingerprint-protection extension such as
  CanvasBlocker
- [ ] A remote or virtual desktop (Citrix, Windows 365, Azure Virtual Desktop, VMware Horizon) and a virtual
  machine: these often draw graphics in software, like servers do
- [ ] Hardware acceleration switched off in the browser's settings, which also falls back to software graphics
- [ ] Full-screen (F11) and kiosk mode, and your site installed as an app if you offer that: no visible browser
  UI is normal there

Only send the `truth=human` link to people you trust to be human. The results are only as good as that
ground truth.

## Step 4: Collect bot sessions

From your computer (needs Chrome or Edge installed):

```bash
pnpm --filter @realhuman/bot-lab lab -- --target=https://<your-demo> --run=pilot-1 --repeat=20
```

The lab's scenarios come in three tiers. Report them separately, because they answer different questions:

| Tier | Scenarios | What it shows |
|---|---|---|
| **Commodity** | HTTP clients, replayed tokens, plain headless browsers, form fillers, leftover automation globals | The bulk of real-world bot traffic |
| **Stealth** | Patched navigator properties, hidden `webdriver` flag | Common "undetectable" plugins |
| **Human-like** | Curved mouse paths, realistic typing, headless markers hidden | Determined, purpose-built bots |

To test tools the lab doesn't include (for example `curl-impersonate`, undetected-chromedriver, Camoufox or an
AI browser agent), point them at:

```
https://<your-demo>/?truth=bot&scenario=<name>&run=pilot-1
```

## Step 5: Build the report

```bash
DEMO_ADMIN_TOKEN=<your token> pnpm --filter @realhuman/eval report -- --url=https://<your-demo> --run=pilot-1
```

This prints the findings and writes `eval-report.html`, a self-contained page you can share. It contains:

- **Findings** in plain English, with 95% confidence intervals
- **Analytics filters:** how many bots and how many real people the standard (`label <> 'bot'`) and strict
  (`label IN ('human', 'unverified')`) filters remove, with confidence intervals. These are the numbers that
  matter for your reporting
- **Results by label** for known humans and known bots
- **Known humans by browser:** labels and filter removals for each browser, platform and privacy browser. A
  small group with a high removal rate is where false positives hide, even when the total looks fine
- **Data availability:** how often each check had no data (no TLS fingerprint, no Web Worker, no graphics
  details, no interaction) for humans and bots, so you can see which checks can actually help your audience
- **ROC curve:** the trade-off between catching bots and flagging humans at every threshold
- **Score distribution:** humans versus bots
- **Per-scenario results**, by label
- **Score analysis:** AUC and threshold-based counts for the `realHuman` score
- **Why humans weren't confirmed** and **why bots got through:** the reason codes to look at when tuning

To try other thresholds without changing anything in production: `--human=0.8 --bot=0.2`.

### Example: the local lab run

This is real output from a local run (55 bot sessions, 5 per scenario, no human sessions yet):

```
• Standard filter (exclude label 'bot'): removes 50 of 55 bots, 90.9% (95% CI 80.4%–96.1%).
• Strict filter (keep only 'human' and 'unverified'): removes 55 of 55 bots, 100.0% (95% CI 93.5%–100.0%).
• No labelled human sessions: the false-positive rate cannot be measured. Collect human sessions before relying on these results.
• 40 of 55 labelled sessions had no TLS fingerprint (JA4), so the network checks didn't run for them.

  humanlike-advanced           0/5 bot · 5 suspicious · 0 unverified · 0 human
  humanlike-headless           5/5 bot · 0 suspicious · 0 unverified · 0 human
  (all 9 other scenarios)      5/5 bot each
```

What it tells you: commodity and stealth automation is labelled `bot` every time. A purpose-built bot with
human-like movement and hidden headless traits lands in `suspicious`, so only the strict filter removes it.
That's the honest limit of what a browser reveals. The missing TLS fingerprints are expected locally, where no
CDN adds one to browser sessions; it's one more reason to test on a deployed demo.

## Step 6: Tune, then confirm on fresh data

1. **Tune on one run.** Look at *Why humans weren't confirmed*. If one reason code keeps appearing on real
   people, its weight is too strong for your audience. Adjust `WEIGHTS` in
   `packages/engine/src/analysis.ts`.
2. **Check the change offline** before deploying. Export the run, re-score it, and re-run the report:
   ```bash
   curl -H "authorization: Bearer $DEMO_ADMIN_TOKEN" "https://<your-demo>/api/export?run=pilot-1" > pilot-1.ndjson
   pnpm --filter @realhuman/engine build          # picks up your WEIGHTS change
   node packages/engine/bin/realhuman-rescore.js < pilot-1.ndjson > pilot-1-rescored.ndjson
   pnpm --filter @realhuman/eval report -- pilot-1-rescored.ndjson
   ```
3. **Confirm on a fresh run** (`pilot-2`) with new sessions. Numbers from the data you tuned on are always
   flattering; the fresh run is the one to quote.

## Step 7: Check it on real traffic

Lab and tester results are a good start, but your real visitors are the final test:

- Deploy to your site in `server` delivery mode, so nothing changes for visitors, and store the records.
- Find groups whose labels you can trust without asking: people who completed a purchase or signed in are almost
  certainly human. Traffic from data-centre networks, or requests marked `ua_bot`, are almost certainly bots.
- Compare their scores using the same report. Records just need `context.truth` set, so add it in your pipeline
  before running the tool.
- When changing weights, re-score a stored sample with `realhuman-rescore` (see step 6) and compare the label
  counts before and after.

## What to publish

A fair statement includes the run id, the date, the sample sizes, the filter and both rates, for example:

> On run `pilot-2` (2026-11-03): 412 human sessions from 38 testers across 9 browser/device types, and 220 bot
> sessions across 11 scenarios. The standard filter (`label <> 'bot'`) removed 0 human sessions (false-positive
> rate below 0.73% at 95% confidence, and no browser group above 0) and 196 of 220 bot sessions (89.1%, 95% CI
> 84.3%–92.6%), including 100% of commodity automation.

The figures above are illustrative: always quote your own report.
