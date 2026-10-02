# Troubleshooting

Find your symptom below. If nothing fits, see [SUPPORT.md](../../SUPPORT.md).

**First step for any problem:** turn on debug logging on both sides and reproduce the issue.

```ts
init({ debug: true });                 // browser console
createHandlers({ debug: true, ... });  // server logs
```

---

### No decision records arrive at all

1. **Is the SDK running?** In the browser's developer tools, open the **Network** tab and reload.
   You should see `GET /api/realhuman/init`, then `POST /api/realhuman/score` about 1 second later.
2. **No `init` request?** `init()` isn't being called, or you set `consent: false` and haven't called
   `grantConsent()` yet.
3. **`init` returns 404?** The server route isn't at the path the SDK expects. On Next.js the file must be
   `app/api/realhuman/[action]/route.ts`, brackets included. If you changed `endpoint`, the route must match.
4. **`score` returns 204 but `onDecision` never runs?** Check the server logs for errors from your callback. It
   may be throwing or exceeding `onDecisionTimeoutMs`.

### `POST /score` returns 403 on AWS

You're using CloudFront → Lambda function URL with OAC, and the SDK isn't sending the body hash. Set
`init({ awsContentHash: true })`. Also check the origin request policy **doesn't** forward the `Host`
header.

### `server.ja4` is always `null`

| Platform | Fix |
|---|---|
| Vercel | Check the request reaches a Vercel deployment directly, not through another proxy or CDN in front of Vercel |
| CloudFront | Add `CloudFront-Viewer-JA4-Fingerprint` to the origin request policy for `/api/realhuman/*` |
| Node | Your proxy isn't setting the header named in `ja4Header`, or `ja4Header` isn't set |

Without JA4 realHuman still works, with less network evidence.

### Everything is `unverified`

- **Short visits with little interaction** genuinely give no evidence either way, so they're `unverified`, not `human`. That's expected, and the standard and strict filters both keep them.
- **The page-close update isn't arriving.** Check for `final: true` records. Some browsers drop requests on close. Calling `rh.score()` at key moments helps.
- **The secret is missing.** Look for a start-up error about `REALHUMAN_SECRET` in the server logs.

### Real people are scored as bots

1. Look at the `reasons` on those records ([reference](../reference/reason-codes.md)).
2. **Many `nonce_invalid`?** Your instances may have **different secrets**. Every instance and region must
   share one `REALHUMAN_SECRET`.
3. **Many `nonce_replayed`?** Something between the visitor and your CDN is changing the TLS connection, such
   as a corporate TLS-inspection proxy. These users will look inconsistent; consider whether they matter for
   your analytics.
4. **Many `honeypot_filled`?** A browser extension or autofill tool may be filling the hidden field.
   Please [open an issue](https://github.com/your-org/realhuman/issues) with the browser and extension, so we
   can add an opt-out.
5. **Privacy browsers?** They should show `kind: "privacy_browser"`. If one isn't recognised, please report it.

### Obvious bots are scored as humans

- Check `server.ja4` is populated. JA4 is one of the strongest signals.
- Check the bots are actually running the SDK. Clients that don't run JavaScript produce no records unless
  you use edge tagging (`tagRequests`).
- Advanced bots, or real people paid to click, can look human. realHuman raises the cost of faking; it can't
  make it impossible.

### The SDK breaks under my Content Security Policy

Allow `connect-src` to your endpoint. The Worker check also needs `worker-src blob:`; without it the
check is skipped and nothing breaks.

### New Relic / Datadog / GA4 don't show the score

1. Is `deliver` set to `'client'` or `'both'` **on the server**?
2. Is the tool's own script on the page and loaded?
3. Remember that events recorded before the first score (~1 s) won't carry it. See
   [Frontend integrations](../guides/frontend-integrations.md).

### Jev records always say `algorithmic-fallback`

- The API key variable named in `apiKeyEnv` is missing or wrong. Check the server logs.
- `timeoutMs` is too low for your region; try 1500.
- Your provider is rate-limiting you (429); add a `failover` provider.
