# @realhuman/vercel

realHuman for Vercel and Next.js. It reads Vercel's JA4 TLS fingerprint (`x-vercel-ja4-digest`) and IP
time zone (`x-vercel-ip-timezone`) automatically, and runs your `onDecision` callback after the response is
sent (Vercel `waitUntil`).

```bash
npm install @realhuman/vercel @realhuman/client
```

## 1. Add a secret

Add the environment variable `REALHUMAN_SECRET` in your Vercel project. Generate a value with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

## 2. Add the route

`app/api/realhuman/[action]/route.ts`:

```ts
import { createHandlers } from '@realhuman/vercel';

export const { GET, POST } = createHandlers({
  onDecision: async (record) => {
    console.log(JSON.stringify({ type: 'realhuman', ...record }));
  },
});
```

## 3. Start the browser SDK

```ts
'use client';
import { init } from '@realhuman/client';
init();
```

## Optional: label requests that never run JavaScript

In `proxy.ts` (`middleware.ts` before Next.js 16):

```ts
import { tagRequests } from '@realhuman/vercel';

export default tagRequests({
  onTag: (tag) => console.log(JSON.stringify({ type: 'realhuman-edge', ...tag })),
});

export const config = { matcher: ['/((?!_next/|api/realhuman/|favicon.ico).*)'] };
```

The tagger never blocks. It forwards a summary header, `x-realhuman-edge`, to your app.

## Documentation

- [Vercel quickstart](../../docs/getting-started/quickstart-vercel.md)
- [Configuration reference](../../docs/reference/configuration.md#vercel-adapter)

## License

MIT
