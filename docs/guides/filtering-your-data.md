# Filtering bots out of your data

> [!NOTE]
> **Planned: milestones M1–M2.** The data formats used below are **available now** in `@realhuman/schema`.

This is the payoff: using realHuman decisions to clean up analytics and reports.

## Step 1: Connect decisions to your analytics data

Your analytics events and realHuman's decision records need a shared key. There are two ways to get one.

### Option A: Pass your analytics ID to realHuman (recommended)

Give the SDK the ID your analytics tool already uses. It's copied into every decision record's `context`:

```ts
init({
  context: () => ({ gaClientId: getGaClientId() }), // or segmentAnonymousId, posthogDistinctId, …
});
```

Decision records then contain `"context": { "gaClientId": "1234567890.1700000000" }`, which you can join
against your analytics export.

- `context` takes up to 10 keys, each value up to 256 characters.
- Use a function if the ID isn't known when `init()` runs. It's evaluated when each update is sent.

### Option B: Send realHuman's `sid` to your analytics tool

Use `deliver: 'both'` and a [frontend integration](frontend-integrations.md), which sends a `bot_verdict`
event containing the `sid`, score and verdict into your analytics tool. You can then join on `sid`, or
filter inside the analytics tool directly.

## Step 2: Pick a threshold

| Threshold | Effect | Good for |
|---|---|---|
| `realHuman >= 0.3` | Removes only obvious bots | Traffic totals where you'd rather keep borderline visits |
| `realHuman >= 0.5` | Balanced | Most reporting |
| `realHuman >= 0.7` | Keeps only confident humans | Experiments and conversion analysis |

Because the score is stored as a number, you can **change your mind later** without collecting anything new.

> [!TIP]
> Also look at `verdict = 'verified_agent'`. These are AI agents and crawlers that identified themselves
> cryptographically. Whether they count as "real" traffic is a business decision. For example, an AI agent
> buying something on a customer's behalf is arguably a real customer.

## Step 3: Filter

### Page views from real people (Option A, BigQuery-style SQL)

```sql
WITH latest AS (
  SELECT *
  FROM realhuman_decisions_raw
  QUALIFY ROW_NUMBER() OVER (PARTITION BY sid ORDER BY seq DESC) = 1
),
visitor_score AS (
  -- One visitor (client id) may have many page loads; average their scores.
  SELECT JSON_VALUE(context, '$.gaClientId') AS client_id,
         AVG(real_human)                     AS real_human
  FROM latest
  GROUP BY client_id
)
SELECT e.*
FROM analytics_events AS e
JOIN visitor_score    AS v ON v.client_id = e.client_id
WHERE v.real_human >= 0.5;
```

### Bot share by day (a good health metric)

These queries reuse the `latest` query from the example above.

```sql
SELECT DATE(ts) AS day,
       COUNTIF(verdict = 'bot')            / COUNT(*) AS bot_share,
       COUNTIF(verdict = 'verified_agent') / COUNT(*) AS agent_share,
       COUNTIF(verdict = 'uncertain')      / COUNT(*) AS uncertain_share
FROM latest
GROUP BY day
ORDER BY day;
```

### Why were sessions flagged?

```sql
SELECT reason, COUNT(*) AS sessions
FROM latest, UNNEST(reasons) AS reason
WHERE verdict = 'bot'
GROUP BY reason
ORDER BY sessions DESC;
```

What each reason means: [Reason codes](../reference/reason-codes.md).

## Visits with no decision

Some page loads never produce a decision record: the visitor left instantly, an ad blocker interfered, or
consent wasn't given. Decide explicitly how to treat them. A common choice is to keep them in totals but
leave them out of conversion-rate maths, and to track the size of this group over time.

## Sanity checks before you trust the numbers

1. **Look at `uncertain_share`.** If it's high, most sessions had too little evidence. Make sure the final
   page-close update is being received, or call `rh.score()` at key moments.
2. **Look at your own traffic.** Your team's visits should score as human. If they don't, see
   [Troubleshooting](../operations/troubleshooting.md).
3. **Run [shadow mode](shadow-mode.md)** before switching engines or thresholds on reports people rely on.
