# Filtering bots out of your data

This is the payoff: using realHuman decisions to clean up analytics and reports.

**The short version:** filter on `label`. It has five values (`human`, `unverified`, `suspicious`, `bot` and
`verified_agent`) and two recommended filters:

| Filter | SQL | Use it for |
|---|---|---|
| **Standard** | `label <> 'bot'` | Traffic totals and general reporting |
| **Strict** | `label IN ('human', 'unverified')` | A/B tests, conversion rates, anything a bot would distort |

What each label means, and exactly how it's decided: [Understanding results](understanding-results.md).

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

### Option B: Send realHuman's `sid` and label to your analytics tool

Use `deliver: 'both'` and a [frontend integration](frontend-integrations.md), which sends a `bot_verdict`
event containing the `sid`, label and score into your analytics tool. You can then join on `sid`, or filter
inside the analytics tool directly. Remember that browser-side copies can be tampered with; the backend record is
the source of truth.

### Attaching a user id

To store the label against a user in your own data table, attach their id to the decision record. There are
two ways, and you can use both.

**From the browser**, for example once the visitor signs in on a page that's already loaded:

```ts
const rh = init();

// later, once you know who it is
rh.setContext({ userId: user.id });
await rh.score(); // optional: send an update with the id straight away
```

`setContext` adds to the `context` option; set a key to `null` to remove it. Without `score()`, the id goes
with the next update, usually the final one as the page closes.

**From your server**, when the id comes from your own session or sign-in cookie. Use this whenever you act on
the id, because a visitor can change anything their browser sends:

```ts
export const { GET, POST } = createHandlers({
  serverContext: async (request) => ({
    userId: (await getSession(request))?.userId ?? null, // null when signed out
  }),
  onDecision: saveDecision, // for example the PostgreSQL upsert from Ingesting decisions
});
```

Either way, the id arrives in the record's `context`. With the table from
[Ingesting decisions](ingesting-decisions.md#postgresql), which keeps the latest update of each page load, you
can then copy each user's most recent label onto your own users table:

```sql
UPDATE users
SET bot_label = latest.label
FROM (
  SELECT DISTINCT ON (context->>'userId') context->>'userId' AS user_id, label
  FROM realhuman_decisions
  WHERE context ? 'userId'
  ORDER BY context->>'userId', ts DESC
) AS latest
WHERE users.id::text = latest.user_id;
```

Writing to the users table straight from `onDecision` works too, but a page load sends several updates that
can arrive out of order, so check `seq` (as the upsert does) before overwriting.

How `serverContext` works:

- It runs on your server for each decision record and receives the request (headers and cookies; the body
  has already been read). Keep it fast.
- **Every key it returns is the server's.** The browser's value for that key is dropped, even when the server
  returns `null` or `undefined`, so a signed-out visitor can't forge a `userId`. Keys it doesn't return are
  left to the browser.
- If it throws, the error is logged and that record has no context at all, so a forged value can't slip
  through while your session store is down.
- Numbers and booleans are turned into strings. Entries that break the limits below are skipped with a warning.

Both share the `context` limits: at most 10 keys (`A–Z a–z 0–9 _ . -`, up to 64 characters) and values up to
256 characters.

> [!NOTE]
> A user id turns decision records into personal data about that user. See
> [Privacy & compliance](../operations/privacy-and-compliance.md#your-own-ids-in-context).

## Step 2: Choose a filter

| Label | Standard filter | Strict filter | Why |
|---|---|---|---|
| `human` | keep | keep | Real interaction seen |
| `unverified` | keep | keep | No evidence either way; almost always a quick real visit |
| `suspicious` | keep | **remove** | Some signs of automation, not conclusive; real people on remote desktops or kiosks can land here |
| `bot` | **remove** | **remove** | Strong or conclusive signs of automation |
| `verified_agent` | your call | your call | Self-identified AI agents and crawlers |

Because the label is stored with every record, you can **switch filters later** without collecting anything
new. To see what each filter does to *your* traffic, run the [evaluation report](evaluation.md): it measures
how many bots and how many real people each filter removes.

> [!TIP]
> Decide what `verified_agent` means for you. These are AI agents and crawlers that proved who they are. An AI
> agent buying something on a customer's behalf is arguably a real customer; a search crawler isn't.

## Step 3: Filter

These examples use BigQuery-style SQL and assume decision records in a table `realhuman_decisions_raw` (see
[Ingesting decisions](ingesting-decisions.md)). Start with the latest decision per page load:

```sql
WITH latest AS (
  SELECT *
  FROM realhuman_decisions_raw
  QUALIFY ROW_NUMBER() OVER (PARTITION BY sid ORDER BY seq DESC) = 1
)
```

### Page views from real visitors (Option A)

One visitor (client id) can have many page loads. Give each visitor the most cautious label seen across them:

```sql
WITH latest AS (…),
visitor AS (
  SELECT JSON_VALUE(context, '$.gaClientId') AS client_id,
         CASE
           WHEN COUNTIF(label = 'bot') > 0        THEN 'bot'
           WHEN COUNTIF(label = 'suspicious') > 0 THEN 'suspicious'
           WHEN COUNTIF(label = 'human') > 0      THEN 'human'
           ELSE 'unverified'
         END AS label
  FROM latest
  GROUP BY client_id
)
SELECT e.*
FROM analytics_events AS e
JOIN visitor AS v ON v.client_id = e.client_id
WHERE v.label <> 'bot';                       -- standard
-- WHERE v.label IN ('human', 'unverified');  -- strict
```

### Traffic mix by day (a good health metric)

```sql
SELECT DATE(ts) AS day,
       COUNTIF(label = 'human')          / COUNT(*) AS human_share,
       COUNTIF(label = 'unverified')     / COUNT(*) AS unverified_share,
       COUNTIF(label = 'suspicious')     / COUNT(*) AS suspicious_share,
       COUNTIF(label = 'bot')            / COUNT(*) AS bot_share,
       COUNTIF(label = 'verified_agent') / COUNT(*) AS agent_share
FROM latest
GROUP BY day
ORDER BY day;
```

### Why were sessions flagged?

`primary_reason` gives one reason per session, which is ideal for dashboards:

```sql
SELECT label, primary_reason, COUNT(*) AS sessions
FROM latest
WHERE label IN ('bot', 'suspicious')
GROUP BY label, primary_reason
ORDER BY sessions DESC;
```

To see every piece of evidence, unnest `reasons` instead:

```sql
SELECT reason, COUNT(*) AS sessions
FROM latest, UNNEST(reasons) AS reason
WHERE label = 'bot'
GROUP BY reason
ORDER BY sessions DESC;
```

Show reason titles rather than codes on dashboards: `REASONS[code].title` in `@realhuman/schema` (for example
"Headless browser traits"), or a lookup table built from [Reason codes](../reference/reason-codes.md).

### Records from before labels existed

Records written by older engine versions have no `label`. Either re-score them with
`npx realhuman-rescore < old.ndjson > new.ndjson`, or treat `verdict` as a fallback: `human` → `human`,
`bot` → `bot`, `uncertain` → `unverified`.

## Visits with no decision

Some page loads never produce a decision record: the visitor left instantly, an ad blocker interfered, or
consent wasn't given. Decide explicitly how to treat them. A common choice is to keep them in totals but
leave them out of conversion-rate maths, and to track the size of this group over time.

## Sanity checks before you trust the numbers

1. **Look at the `unverified` share.** If it's very high, most visits had too little interaction to confirm.
   Make sure the page-close update is being received, or call `rh.score()` at key moments such as form submits.
2. **Look at your own traffic.** Your team's visits should be `human`. If they're `suspicious`, check
   `primary_reason`, and see [Troubleshooting](../operations/troubleshooting.md).
3. **Measure before you rely on it.** The [evaluation method](evaluation.md) shows how many bots and how many
   real people each filter removes, with confidence intervals.
