# realHuman evaluation report

Turns labelled decision records into the numbers that show whether realHuman works: detection rate,
false-positive rate (with 95% confidence intervals), AUC, a ROC curve and per-scenario results.

```bash
# From a deployed Vercel demo (needs the demo's DEMO_ADMIN_TOKEN)
DEMO_ADMIN_TOKEN=… pnpm --filter @realhuman/eval report -- --url=https://your-demo.vercel.app --run=pilot-1

# From the local demo while it's running
pnpm --filter @realhuman/eval report -- --url=http://localhost:3000

# From exported files
pnpm --filter @realhuman/eval report -- records.ndjson more.ndjson
```

| Option | Meaning |
|---|---|
| `--run=<id>` | Only sessions from this test run |
| `--human=0.7 --bot=0.3` | Thresholds to evaluate (defaults match the engine) |
| `--out=report.html` | Where to write the HTML report (default `eval-report.html`) |
| `--json` | Print the raw numbers as JSON instead |

Sessions are marked as known humans or known bots by `context.truth` (`human` or `bot`), which the demo sets
from `?truth=` in the page URL and the bot lab sets automatically. (`?label=` / `context.label` from earlier
versions still work.) The report compares that truth with realHuman's own `label`. Each session counts once, using its latest update.

The full method: [Proving it works](../../docs/guides/evaluation.md).
