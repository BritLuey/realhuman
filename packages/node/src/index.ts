import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import {
  createRealHuman,
  type EngineOptions,
  type RealHuman,
  type TrustedFacts,
} from '@realhuman/engine';

export type { DecisionRecord, EdgeTag, EngineOptions } from '@realhuman/engine';

export interface NodeAdapterOptions extends EngineOptions {
  /**
   * Header your TLS-terminating proxy sets with the JA4 fingerprint, e.g. `'x-ja4'`.
   * Only set this if the proxy always overwrites the header; otherwise clients can forge it.
   */
  readonly ja4Header?: string;
  /** Header your proxy sets with the client IP's IANA time zone, if any. */
  readonly timezoneHeader?: string;
  /**
   * Hook for platforms with a background-task API. By default background work (onDecision,
   * shadow engines) runs in-process after the response is sent; call `drain()` on shutdown.
   */
  readonly waitUntil?: (promise: Promise<unknown>) => void;
}

export interface WebHandler {
  (request: Request): Promise<Response>;
  /** Labels a request from network evidence alone. */
  tag: RealHuman['tag'];
  /** Resolves once all in-flight background work (e.g. onDecision) has finished. */
  drain(): Promise<void>;
  readonly engine: RealHuman;
}

export interface NodeHandler {
  (req: IncomingMessage, res: ServerResponse, next?: (error?: unknown) => void): void;
  /** Resolves once all in-flight background work (e.g. onDecision) has finished. */
  drain(): Promise<void>;
  readonly engine: RealHuman;
}

function trustedFrom(headers: Headers, options: NodeAdapterOptions): TrustedFacts {
  return {
    ja4: options.ja4Header ? headers.get(options.ja4Header) : null,
    ipTimezone: options.timezoneHeader ? headers.get(options.timezoneHeader) : null,
  };
}

/**
 * A `(Request) => Promise<Response>` handler for Web-standard servers: Hono, Bun, Deno,
 * Fastify with a fetch adapter, and anything else that speaks `Request`/`Response`.
 */
export function createWebHandler(options: NodeAdapterOptions = {}): WebHandler {
  const engine = createRealHuman(options);
  const pending = new Set<Promise<unknown>>();
  const waitUntil =
    options.waitUntil ??
    ((promise: Promise<unknown>) => {
      pending.add(promise);
      void promise.finally(() => pending.delete(promise));
    });

  const handler = ((request: Request) =>
    engine.handle(request, {
      trusted: trustedFrom(request.headers, options),
      waitUntil,
    })) as WebHandler;
  handler.tag = (request, trusted) => engine.tag(request, trusted);
  handler.drain = async () => {
    while (pending.size > 0) await Promise.allSettled([...pending]);
  };
  Object.defineProperty(handler, 'engine', { value: engine });
  return handler;
}

/** Converts a Node.js request into a Web `Request`. */
export function toWebRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const encrypted = (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true;
  const url = new URL(
    req.url ?? '/',
    `${encrypted ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`,
  );
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(url, {
    method,
    headers,
    ...(hasBody && { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' }),
  } as RequestInit);
}

/** Writes a Web `Response` to a Node.js response. */
export async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : null;
  res.end(body);
}

/**
 * Middleware for Express, Connect and `node:http`. Mount it at your endpoint path:
 *
 * ```ts
 * app.use('/api/realhuman', createNodeHandler({ onDecision }));
 * ```
 *
 * Mount it before any body parser for that path; it reads the body itself.
 */
export function createNodeHandler(options: NodeAdapterOptions = {}): NodeHandler {
  const web = createWebHandler(options);
  const handler = ((req, res, next) => {
    web(toWebRequest(req))
      .then((response) => writeWebResponse(response, res))
      .catch((error) => {
        // The engine never throws; this only covers socket-level failures.
        if (next) next(error);
        else if (!res.headersSent) {
          res.statusCode = 204;
          res.end();
        }
      });
  }) as NodeHandler;
  handler.drain = web.drain;
  Object.defineProperty(handler, 'engine', { value: web.engine });
  return handler;
}
