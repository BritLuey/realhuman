# Quickstart: Node.js (self-hosted)

Use this if you run your own Node.js server (Express, Fastify, Hono…) rather than Vercel or CloudFront.

**Time needed:** about 15 minutes.

## The one thing to get right: the JA4 fingerprint

The JA4 fingerprint comes from the TLS (HTTPS) handshake, so it can only be computed by whatever
**terminates TLS**. That's usually a reverse proxy or load balancer in front of Node.js, not Node itself.

| Your setup | How to get JA4 |
|---|---|
| nginx in front | Use an nginx JA4 module and pass the value in a header, e.g. `proxy_set_header X-JA4 $ja4;` |
| HAProxy in front | Use a JA4 Lua script or plugin and set a request header |
| A cloud load balancer | Check whether it can add a JA4 header. Some can, some can't |
| Node terminates TLS itself | Not supported yet. realHuman still works, with less network evidence |

If you can't get JA4, realHuman still works, just with less network evidence. Leave `ja4Header` unset.

> [!CAUTION]
> Only set `ja4Header` if your proxy **always overwrites** that header. Otherwise anyone can send a fake
> fingerprint. See [Security: trusted headers](../operations/security.md#trusted-headers).

## Step 1: Install

```bash
npm install @realhuman/node @realhuman/client
```

## Step 2: Create a secret

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Save the output as the environment variable `REALHUMAN_SECRET` wherever your server reads its
configuration (for example your secrets manager, or `.env` for local development only).

## Step 3: Mount the handler (Express example)

```ts
import express from 'express';
import { createNodeHandler } from '@realhuman/node';

const app = express();

app.use(
  '/api/realhuman',
  createNodeHandler({
    ja4Header: 'x-ja4', // the header your proxy sets; omit if you don't have one
    timezoneHeader: undefined, // set if your proxy adds an IP time-zone header
    onDecision: async (record) => {
      console.log(JSON.stringify({ type: 'realhuman', ...record }));
    },
  }),
);

app.listen(3000);
```

Mount it **before** any body-parsing middleware for that path; the handler reads the request body itself.

Using Fastify, Hono or another framework that accepts standard `Request`/`Response` objects? Use
`createWebHandler` from the same package instead.

## Step 4: Start the SDK in the browser

```ts
import { init } from '@realhuman/client';
init();
```

## Step 5: Check it works

Open your site, move the mouse for a few seconds and watch your server logs for `realhuman` records.
If `server.ja4` is `null`, your proxy isn't setting the header named in `ja4Header`.

Next: [Ingesting decisions](../guides/ingesting-decisions.md) · [Configuration](../reference/configuration.md#node-adapter) · [Troubleshooting](../operations/troubleshooting.md)
