# @realhuman/client

The realHuman browser SDK. It scores each page load from 0 (bot) to 1 (human) **for analytics filtering
only: it never blocks anyone.**

It collects short summaries of how the page is used (never key values, form contents, coordinates or
device fingerprints), stores nothing on the device, and sends the summaries to **your own server**, which
runs the realHuman engine. Under 8 KB gzipped, with no dependencies.

## Install

```bash
npm install @realhuman/client
```

```ts
import { init } from '@realhuman/client';

const rh = init(); // once per page load, as early as you can
```

No bundler? Copy `node_modules/@realhuman/client/dist/realhuman.iife.js` to your site and add:

```html
<script src="/realhuman.js" data-endpoint="/api/realhuman" defer></script>
```

The instance is then available as `window.realHuman`.

You also need the server side: see the quickstarts for
[Vercel](../../docs/getting-started/quickstart-vercel.md),
[Node](../../docs/getting-started/quickstart-node.md) or
[CloudFront](../../docs/getting-started/quickstart-cloudfront.md).

## Common tasks

```ts
// Score right before an important action. Never throws, never blocks.
form.addEventListener('submit', () => rh.score());

// Wait for consent from your CMP: nothing is collected or sent before grantConsent().
const rh = init({ consent: false });
onConsentGranted(() => rh.grantConsent());

// Protect a form with a honeypot (or just add data-realhuman to the <form>).
rh.attach(document.querySelector('form#signup') as HTMLFormElement);

// Receive results in the browser (needs deliver: 'client' or 'both' on the server).
rh.on('result', (result) => console.log(result.realHuman, result.verdict));
```

## Integrations

Pass the score to the tools already on your page. Each is a separate import:

```ts
import { newRelic } from '@realhuman/client/integrations/new-relic';
import { ga4 } from '@realhuman/client/integrations/ga4';

init({ integrations: [newRelic(), ga4()] });
```

Available: `new-relic`, `datadog-rum`, `ga4`, `data-layer` (Google Tag Manager), `segment`, `posthog`.

## Learn more

- [Browser SDK guide](../../docs/guides/browser-sdk.md)
- [Honeypots](../../docs/guides/honeypots.md)
- [Frontend integrations](../../docs/guides/frontend-integrations.md)
- [All options](../../docs/reference/configuration.md#browser-sdk)
- [What is collected, and why](../../docs/reference/signals.md)
- [Privacy & compliance](../../docs/operations/privacy-and-compliance.md)
