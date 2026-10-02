# Quickstart: Vercel (Next.js)

> [!NOTE]
> **Planned: milestones M1–M3.** This guide shows the intended setup so you can plan your integration.
> It will work once `@realhuman/client`, `@realhuman/engine` and `@realhuman/vercel` are released. See the [roadmap](../roadmap.md).

**Time needed:** about 10 minutes.
**You'll end up with:** every page load on your site scored, and the results in your Vercel logs.

## Before you start

You need:

- [ ] A Next.js app (App Router) deployed on Vercel
- [ ] Node.js 22 or newer on your computer
- [ ] Permission to add environment variables to the Vercel project

> [!TIP]
> Not using Next.js? Any Vercel project that can serve a function at `/api/realhuman/*` works. Use the
> same handler code in `api/realhuman/[action].ts`.

## Step 1: Install the packages

In your project folder, run:

```bash
npm install @realhuman/client @realhuman/vercel
```

(`pnpm add` or `yarn add` work too.)

## Step 2: Create a secret

realHuman signs its session tokens with a secret so they can't be forged. Generate one:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Copy the output, then in the Vercel dashboard:

1. Open your project → **Settings** → **Environment Variables**.
2. **Key:** `REALHUMAN_SECRET`
3. **Value:** paste the secret.
4. **Environments:** tick Production, Preview and Development.
5. Click **Save**.

> [!CAUTION]
> Treat this like a password. Never commit it to Git or paste it into browser code.

To use it locally too, pull it into `.env.local`:

```bash
vercel env pull .env.local
```

## Step 3: Add the server route

Create the file **`app/api/realhuman/[action]/route.ts`** (the square brackets are part of the folder name):

```ts
import { createHandlers } from '@realhuman/vercel';

export const { GET, POST } = createHandlers({
  // Called for every decision. Start by logging; send it to your pipeline later.
  onDecision: async (record) => {
    console.log(JSON.stringify({ type: 'realhuman', ...record }));
  },
});
```

That's all the server code you need. The adapter:

- reads the secret from `REALHUMAN_SECRET`,
- reads the visitor's JA4 fingerprint from Vercel's `x-vercel-ja4-digest` header and their IP time zone from `x-vercel-ip-timezone`,
- runs `onDecision` *after* the response has been sent (using Vercel's `waitUntil`), so your code never slows the endpoint down.

## Step 4: Start the SDK in the browser

Create **`app/realhuman.tsx`**:

```tsx
'use client';
import { useEffect } from 'react';
import { init } from '@realhuman/client';

export function RealHuman() {
  useEffect(() => {
    const rh = init(); // defaults: endpoint '/api/realhuman', first update after 1000 ms
    return () => rh.destroy();
  }, []);
  return null;
}
```

Then add it to **`app/layout.tsx`** so it runs on every page:

```tsx
import { RealHuman } from './realhuman';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RealHuman />
      </body>
    </html>
  );
}
```

## Step 5: Deploy and check it works

1. Commit and push (or run `vercel deploy`).
2. Open your site in a normal browser. Move the mouse and scroll for a few seconds.
3. In the Vercel dashboard, open **Logs** and search for `realhuman`.

✅ **It worked if** you see a line like:

```json
{"type":"realhuman","v":1,"sid":"k3J9x0aQ2mW8pL5rT7yB","seq":0,"realHuman":0.88,"verdict":"human", "...": "..."}
```

For a second check, open the site in a headless browser (for example `npx playwright open --browser=chromium`
with automation flags). You should see a much lower score.

Nothing showing up? See [Troubleshooting](../operations/troubleshooting.md).

## Optional next steps

| Want to… | Do this |
|---|---|
| Send results to a database or warehouse | [Ingesting decisions](../guides/ingesting-decisions.md) |
| Show the score to New Relic, Datadog or GA4 | Set `deliver: 'both'`, then follow [Frontend integrations](../guides/frontend-integrations.md) |
| Add honeypots to your forms | Add `data-realhuman` to the `<form>`. See [Honeypots](../guides/honeypots.md) |
| Use the Jev engine | [Jev engine](../guides/jev-engine.md) |
| Wait for cookie consent | `init({ consent: false })`, then `rh.grantConsent()`. See [Browser SDK](../guides/browser-sdk.md#consent) |

### Optional: label visitors who don't run JavaScript

To label every request in your logs, including bots that never run the SDK, add the tagger to
**`proxy.ts`** in your project root (named `middleware.ts` before Next.js 16):

```ts
import { tagRequests } from '@realhuman/vercel';

export default tagRequests({
  onTag: (tag) => console.log(JSON.stringify({ type: 'realhuman-edge', ...tag })),
});

export const config = {
  matcher: ['/((?!_next/|api/realhuman/|favicon.ico).*)'],
};
```

This only reads headers. It never blocks or changes the response.
