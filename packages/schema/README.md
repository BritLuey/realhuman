# @realhuman/schema

Data formats and TypeScript types shared by every [realHuman](https://github.com/your-org/realhuman)
package.

Install it directly if you **process realHuman data yourself**, for example to validate decision records in
an ingestion pipeline. Other realHuman packages already include it.

```bash
npm install @realhuman/schema
```

## Validate data

Every parser **never throws** and **drops unknown fields**:

```ts
import { parseDecisionRecord } from '@realhuman/schema';

const result = parseDecisionRecord(JSON.parse(line));

if (result.success) {
  console.log(result.output.realHuman, result.output.verdict);
} else {
  console.warn('Invalid record:', result.issues); // ["realHuman: Invalid value: ..."]
}
```

| Function | Validates |
|---|---|
| `parseInitResponse(input)` | Response of `GET {endpoint}/init` |
| `parsePayload(input)` | Body of `POST {endpoint}/score` |
| `parseClientResult(input)` | Response of `POST {endpoint}/score` (client/both delivery) |
| `parseDecisionRecord(input)` | Records passed to `onDecision` |

## Types

```ts
import type { DecisionRecord, ClientResult, Payload, Verdict, Kind, ReasonCode } from '@realhuman/schema';
```

## Reason codes

```ts
import { REASONS, REASON_CODES } from '@realhuman/schema';

REASONS.honeypot_filled.description; // 'A hidden honeypot form field was filled in.'
REASONS.honeypot_filled.lean;        // 'bot'
```

## Raw schemas

The [Valibot](https://valibot.dev) schemas are exported too (`DecisionRecordSchema`, `PayloadSchema`, …)
if you want to compose them.

## Documentation

- [Data formats reference](../../docs/reference/data-formats.md)
- [Reason codes](../../docs/reference/reason-codes.md)
- [Signals](../../docs/reference/signals.md)

## License

MIT
