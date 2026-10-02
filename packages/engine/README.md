# @realhuman/engine

The realHuman scoring engine. It issues session nonces, combines browser signals with network evidence
(JA4, user agent, Client Hints, fetch metadata, Web Bot Auth) and produces decision records.

**Most people don't install this directly.** Use the adapter for your platform, which includes it:

| Platform | Package |
|---|---|
| Vercel / Next.js | [`@realhuman/vercel`](../vercel) |
| AWS CloudFront + Lambda | [`@realhuman/aws`](../aws) |
| Node.js, Hono, Bun, Deno | [`@realhuman/node`](../node) |

Install the engine directly to build your own adapter, re-score stored records, or reuse the analysis
functions.

```bash
npm install @realhuman/engine
```

## Build an adapter

The engine uses only Web-standard APIs (`Request`, `Response`, `crypto.subtle`, `fetch`), so it runs anywhere.

```ts
import { createRealHuman } from '@realhuman/engine';

const realHuman = createRealHuman({ onDecision: (record) => console.log(record) });

export default {
  fetch(request: Request, env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }) {
    return realHuman.handle(request, {
      // Only pass values set by a CDN or proxy the client can't bypass.
      trusted: { ja4: request.headers.get('x-my-cdn-ja4'), ipTimezone: null },
      waitUntil: (p) => ctx.waitUntil(p),
    });
  },
};
```

Without `waitUntil`, background work (such as `onDecision`) finishes before the response is returned.

## Re-score stored records

When the engine improves, re-score historical decision records from their stored signals:

```bash
npx realhuman-rescore < decisions.ndjson > rescored.ndjson
```

Or in code:

```ts
import { rescore } from '@realhuman/engine';
const updated = rescore(record); // fresh label, evidence levels, score and reasons
```

## Attach your own ids

`serverContext` adds trusted values to every record, worked out on your server, for example the
signed-in user's id from your session:

```ts
const realHuman = createRealHuman({
  serverContext: async (request) => ({ userId: (await userIdFromSession(request)) ?? null }),
  onDecision,
});
```

Every key it returns replaces the browser's value, even when it's null, so a browser can't forge it. See
[Filtering your data](../../docs/guides/filtering-your-data.md#attaching-a-user-id).

## Use the analysis directly

`analyze()` turns signals and network facts into weighted evidence, and `decide()` turns that into a
label, evidence levels, score and reasons. Both are pure functions, handy for offline analysis.

## Documentation

- [Configuration reference](../../docs/reference/configuration.md#engine-options)
- [How it works](../../docs/getting-started/how-it-works.md)
- [Reason codes](../../docs/reference/reason-codes.md)
- [Security](../../docs/operations/security.md)

## License

MIT
