# Shadow mode: compare engines safely

Shadow mode runs a **second engine** on every session and stores its answer alongside the main one.
Nothing about the main score changes. Use it to compare the algorithmic engine with Jev, or a new
configuration with your current one, before switching.

## Turn it on

```ts
import { jev } from '@realhuman/jev';

createHandlers({
  engine: 'algorithmic', // still decides the label, score, etc.
  shadow: jev({ provider: 'vercel-ai-gateway', apiKeyEnv: 'AI_GATEWAY_API_KEY' }),
  onDecision,
});
```

Each decision record now has a `shadow` field:

```json
{
  "label": "unverified", "realHuman": 0.6, "engine": "algorithmic",
  "shadow": { "engine": "jev", "label": "human", "realHuman": 0.93, "verdict": "human", "reasons": ["jev_decision"] }
}
```

The shadow engine always runs **after** the response is sent, so it never adds latency, even in `client` or
`both` delivery mode.

## Compare the results

How often do the engines disagree?

```sql
SELECT label AS main_label,
       JSON_VALUE(record, '$.shadow.label') AS shadow_label,
       COUNT(*) AS sessions
FROM latest
GROUP BY main_label, shadow_label
ORDER BY sessions DESC;
```

Then look closely at the disagreements:

```sql
SELECT sid, real_human, JSON_VALUE(record, '$.shadow.realHuman') AS shadow_score, reasons
FROM latest
WHERE label != JSON_VALUE(record, '$.shadow.label')
LIMIT 100;
```

(`latest` is the "latest decision per page load" query from [Ingesting decisions](ingesting-decisions.md#data-warehouses-bigquery-snowflake-redshift-databricks).)

## Deciding which is better

Agreement tells you how *different* two engines are, not which one is *right*. To judge accuracy you
need some sessions where you know the truth:

- **Known humans:** your own team, logged-in customers with purchase history, sessions that completed
  a payment.
- **Known bots:** traffic from your own monitoring or test scripts, sessions with `honeypot_filled`, requests
  from data-centre networks you've confirmed are scrapers.

Compare how each engine scores those groups. The engine that separates them better wins.

## Cost

A shadow Jev engine is billed like a main one. Turn shadow mode off once you've decided.
