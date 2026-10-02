# @realhuman/node

realHuman for self-hosted servers: Express, Connect and `node:http` (`createNodeHandler`), plus Hono, Bun,
Deno and anything else built on Web `Request`/`Response` (`createWebHandler`).

```bash
npm install @realhuman/node @realhuman/client
```

## Express

```ts
import express from 'express';
import { createNodeHandler } from '@realhuman/node';

const app = express();
const realHuman = createNodeHandler({
  ja4Header: 'x-ja4', // only if your TLS-terminating proxy always sets/overwrites it
  onDecision: async (record) => console.log(JSON.stringify(record)),
});

app.use('/api/realhuman', realHuman); // before any body parser for this path

const server = app.listen(3000);
process.on('SIGTERM', async () => {
  server.close();
  await realHuman.drain(); // let in-flight onDecision calls finish
});
```

## Hono / Bun / Deno

```ts
import { createWebHandler } from '@realhuman/node';

const realHuman = createWebHandler({ onDecision });
app.all('/api/realhuman/*', (c) => realHuman(c.req.raw)); // Hono
```

## Getting the JA4 fingerprint

JA4 comes from the TLS handshake, so whatever terminates TLS (nginx, HAProxy, a load balancer) must compute
it and pass it in a header. Without it realHuman still works, with less network evidence. See the
[Node.js quickstart](../../docs/getting-started/quickstart-node.md).

## License

MIT
