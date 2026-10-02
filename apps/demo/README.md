# realHuman demo

A local test site: a page running the browser SDK, the Node adapter scoring every visit, and a live table
of decision records with reason codes.

```bash
pnpm install
pnpm build
pnpm --filter @realhuman/demo start
```

Open <http://localhost:3000>. Move the mouse, scroll, type in the form and press **Score now**. Your label
appears at the top, and the server-side records, reason codes included, appear in the table.

| Setting | How |
|---|---|
| Port | `PORT=4000 pnpm --filter @realhuman/demo start` |
| Fixed secret | Set `REALHUMAN_SECRET`; otherwise a random one is generated per run |
| Simulate a CDN's JA4 header | `DEMO_TRUST_JA4_HEADER=x-ja4`, then send `x-ja4: <fingerprint>` with requests |

There's no CDN locally, so `server.ja4` is `null` unless you simulate it. Everything else works as in production.
