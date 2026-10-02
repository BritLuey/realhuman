# Ingesting decisions

Every decision reaches your backend through the `onDecision` callback. This page shows how to store them.

## The callback

```ts
createHandlers({
  onDecision: async (record) => {
    // record is a DecisionRecord. See the Data formats reference.
  },
});
```

What you can rely on:

- `onDecision` runs **after** the HTTP response has been sent, so it never slows the visitor down.
- It is called **once per update**, so one page load can produce several records with the same `sid`.
- If it throws or times out, the error is logged and the visitor is unaffected. realHuman doesn't retry,
  so if you need guaranteed delivery, hand the record to a durable queue (SQS, Kinesis, Pub/Sub, Kafka) as
  the first thing you do.

## The golden rule: one row per `sid`, highest `seq` wins

```
sid k3J9…  seq 0  realHuman 0.52  confidence 0.20   ← first update (1 s in)
sid k3J9…  seq 1  realHuman 0.93  confidence 0.81   ← before signup submit
sid k3J9…  seq 2  realHuman 0.95  confidence 0.88   ← page closed (final)
```

Keep **seq 2**. If the page-close update never arrives, which is common on mobile, keep **seq 1**. Never
wait for `final: true`.

## Recipes

### Logs (simplest)

```ts
onDecision: (record) => console.log(JSON.stringify({ type: 'realhuman', ...record })),
```

Then route logs to your warehouse with **Vercel Log Drains** or a **CloudWatch Logs subscription**.

### PostgreSQL

Create the table once:

```sql
CREATE TABLE realhuman_decisions (
  sid           text PRIMARY KEY,
  seq           integer     NOT NULL,
  ts            timestamptz NOT NULL,
  real_human    real        NOT NULL,
  verdict       text        NOT NULL,
  kind          text        NOT NULL,
  confidence    real        NOT NULL,
  engine        text        NOT NULL,
  reasons       text[]      NOT NULL,
  context       jsonb       NOT NULL,
  record        jsonb       NOT NULL  -- the full record, for re-scoring later
);
```

Upsert each record. The `WHERE` clause makes sure an older update never overwrites a newer one, even if
they arrive out of order:

```sql
INSERT INTO realhuman_decisions
  (sid, seq, ts, real_human, verdict, kind, confidence, engine, reasons, context, record)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (sid) DO UPDATE SET
  seq = EXCLUDED.seq, ts = EXCLUDED.ts, real_human = EXCLUDED.real_human,
  verdict = EXCLUDED.verdict, kind = EXCLUDED.kind, confidence = EXCLUDED.confidence,
  engine = EXCLUDED.engine, reasons = EXCLUDED.reasons, context = EXCLUDED.context,
  record = EXCLUDED.record
WHERE realhuman_decisions.seq < EXCLUDED.seq;
```

### Data warehouses (BigQuery, Snowflake, Redshift, Databricks)

Warehouses work best if you **append every record** and pick the latest at query time:

```sql
-- Latest decision per page load
SELECT * FROM realhuman_decisions_raw
QUALIFY ROW_NUMBER() OVER (PARTITION BY sid ORDER BY seq DESC) = 1;
```

(Redshift doesn't support `QUALIFY`; wrap the window function in a subquery and filter on it.)

Typical pipelines:

| Platform | Path |
|---|---|
| AWS | `onDecision` → Kinesis Data Firehose → S3 / Redshift / Snowflake |
| Vercel | `console.log` → Log Drain → your log platform or warehouse |
| GCP | `onDecision` → Pub/Sub → BigQuery subscription |
| Anything | `onDecision` → `fetch()` to your own ingestion API |

### Validating records in your pipeline

If your pipeline is in TypeScript, validate records with the published schema:

```ts
import { parseDecisionRecord } from '@realhuman/schema';

const result = parseDecisionRecord(JSON.parse(line));
if (!result.success) console.warn('bad record', result.issues);
```

## Why keep the full record?

Store `record` (or at least `signals`) as well as the score. When the engine improves, you can **re-score
historical data** from the stored signals without having collected anything new. Use the CLI that ships
with the engine (export your records as NDJSON, one record per line):

```bash
npx realhuman-rescore < decisions.ndjson > rescored.ndjson
```

Or call `rescore(record)` from `@realhuman/engine` in your own pipeline.

## Retention

Records contain no direct identifiers, but they may hold **your** join keys in `context` (for example an
analytics client id). Apply the same retention policy as your analytics data. See
[Privacy & compliance](../operations/privacy-and-compliance.md#retention).
