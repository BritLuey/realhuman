# Browser SDK

The browser SDK is the small script that runs in your pages. It collects signals, adds honeypots and sends
summaries to your server.

## Install

### With a bundler (React, Next.js, Vue, Vite…)

```bash
npm install @realhuman/client
```

```ts
import { init } from '@realhuman/client';

const rh = init();
```

Call `init()` **once per page load**, as early as you can. Signals are collected from the moment it runs.
Calling it again returns the same instance (new options are ignored) until `rh.destroy()`. It's safe to call
during server-side rendering: it returns an inert instance there.
In a single-page app, call it once when the app starts, not on every route change.

### With a script tag (no build step)

Copy `node_modules/@realhuman/client/dist/realhuman.iife.js` to your site, for example as `/realhuman.js`,
and add:

```html
<script src="/realhuman.js" data-endpoint="/api/realhuman" defer></script>
```

The script starts itself and exposes the instance as `window.realHuman`.

> [!TIP]
> **Host the script on your own domain.** Ad blockers often block third-party scripts with
> "bot" in the name. A first-party script at a neutral path is far less likely to be blocked.

Script-tag attributes map to options: `data-endpoint`, `data-flush-after-ms`, `data-consent="false"`,
`data-aws-content-hash="true"`, `data-debug="true"`.

## Options

All options are optional. The [Configuration reference](../reference/configuration.md#browser-sdk) has
the complete table; these are the ones most people change:

```ts
init({
  endpoint: '/api/realhuman', // where your server route lives
  flushAfterMs: 1000,         // when to send the first update
  sendOnPageHide: true,       // send a final update when the page closes
  consent: true,              // false = collect nothing until grantConsent()
  context: { gaClientId },    // your own join keys, copied into decision records
  honeypot: { forms: 'form[data-realhuman]' },
  onResult: (result) => {},   // called when the server returns a score (client/both modes)
});
```

## The instance

`init()` returns an instance:

| Member | What it does |
|---|---|
| `rh.sid` | This page load's session id. Use it to join with other data. Empty until the server has answered `init`. |
| `rh.ready` | A promise for the first result. Resolves to `null` in `server` delivery mode. |
| `rh.score()` | Sends an update now and returns a promise for its result. Use it before important actions. |
| `rh.on('result', fn)` / `rh.off('result', fn)` | Run `fn` for every result. |
| `rh.attach(form)` | Add a honeypot and timing checks to a specific form element. |
| `rh.grantConsent()` | Start collecting, if you initialised with `consent: false`. |
| `rh.destroy()` | Stop collecting and remove listeners and honeypots. |

### Example: score before a signup is submitted

```ts
form.addEventListener('submit', async () => {
  await rh.score(); // makes sure the decision record includes behaviour on this form
});
```

`score()` never throws and never blocks submission. If the network fails, it resolves to `null`.

## Consent

If your consent management platform (CMP) must allow realHuman first, typically together with analytics:

```ts
const rh = init({ consent: false }); // nothing is collected or sent yet

onConsentGranted(() => rh.grantConsent()); // your CMP's callback
```

Before `grantConsent()` the SDK adds no listeners, makes no network requests and injects no honeypots.
See [Privacy & compliance](../operations/privacy-and-compliance.md).

## Turning collectors off

Each signal group can be switched off:

```ts
init({
  collectors: { keyboard: false }, // for example, on pages where you don't want typing rhythm at all
});
```

Groups: `pointer`, `keyboard`, `touch`, `scroll`, `environment`, `timing`. A switched-off group is sent as
`null`, and the engine treats it as "no evidence", not as suspicious.

## Single-page apps

- Call `init()` once. It keeps collecting across route changes.
- Use `rh.score()` on route changes if you want a fresh decision per "virtual page".
- Call `rh.destroy()` only if the whole app is torn down (for example in tests).

## Content Security Policy (CSP)

The SDK uses no `eval` and no inline scripts, and it sets honeypot styles through the CSSOM, so it works
under a strict CSP. You may need:

| Directive | Value | Why |
|---|---|---|
| `connect-src` | `'self'` (or your endpoint's origin) | Sending updates |
| `worker-src` | `blob:` | The Worker consistency check. If blocked, that one check is skipped |

If the trap link is enabled, it uses one non-passive click listener so it can cancel navigation.

## Guarantees

- **Never throws** into your code. Errors are swallowed, or logged when `debug: true`.
- **Never blocks** rendering, input or navigation. Listeners are passive; heavy work runs when the browser is idle.
- **Small:** core about 8 KB gzipped (budget 8.5 KB), with no dependencies. See [Performance](../operations/performance.md).
- **Stores nothing** on the device.
- **Never mislabels idle tabs.** The final page-close update is skipped if the session nonce has already expired,
  so a tab left open for hours isn't scored as a bot.

## Debugging

```ts
init({ debug: true });
```

Logs each update, its size and the server's response to the browser console. Reason codes are never sent to
the browser, so look in your decision records for those.
