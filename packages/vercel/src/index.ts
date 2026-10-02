import {
  createRealHuman,
  type EdgeTag,
  type EngineOptions,
  type RealHuman,
  type TrustedFacts,
} from '@realhuman/engine';
import { next, waitUntil } from '@vercel/functions';

export type { DecisionRecord, EdgeTag, EngineOptions } from '@realhuman/engine';

/** Set by Vercel's edge from the TLS handshake. Clients can't override it. */
export const VERCEL_JA4_HEADER = 'x-vercel-ja4-digest';
/** Set by Vercel's edge from the client IP. */
export const VERCEL_TIMEZONE_HEADER = 'x-vercel-ip-timezone';

/** Reads the network facts Vercel adds to every request. */
export function trustedFacts(headers: Headers): TrustedFacts {
  return {
    ja4: headers.get(VERCEL_JA4_HEADER),
    ipTimezone: headers.get(VERCEL_TIMEZONE_HEADER),
  };
}

/**
 * Vercel's `waitUntil` only works inside a Vercel request context. Outside one (local
 * development, tests) background work is awaited before responding instead of being dropped.
 */
function platformWaitUntil(): ((promise: Promise<unknown>) => void) | undefined {
  const store = (globalThis as Record<symbol, { get?: () => { waitUntil?: unknown } } | undefined>)[
    Symbol.for('@vercel/request-context')
  ];
  return typeof store?.get?.()?.waitUntil === 'function'
    ? (promise) => waitUntil(promise)
    : undefined;
}

export interface RealHumanHandlers {
  readonly GET: (request: Request) => Promise<Response>;
  readonly POST: (request: Request) => Promise<Response>;
  readonly OPTIONS: (request: Request) => Promise<Response>;
  /** The underlying engine, for advanced use. */
  readonly engine: RealHuman;
}

/**
 * Route handlers for `app/api/realhuman/[action]/route.ts` (Next.js App Router) or any Vercel
 * Function that receives `/api/realhuman/init`, `/score` and `/t`.
 *
 * ```ts
 * export const { GET, POST } = createHandlers({ onDecision: (record) => console.log(record) });
 * ```
 */
export function createHandlers(options: EngineOptions = {}): RealHumanHandlers {
  const engine = createRealHuman(options);
  const handler = (request: Request): Promise<Response> => {
    const waitUntilFn = platformWaitUntil();
    return engine.handle(request, {
      trusted: trustedFacts(request.headers),
      ...(waitUntilFn && { waitUntil: waitUntilFn }),
    });
  };
  return { GET: handler, POST: handler, OPTIONS: handler, engine };
}

export interface TagRequestsOptions
  extends Pick<EngineOptions, 'thresholds' | 'ja4' | 'webBotAuth' | 'logger' | 'debug' | 'now'> {
  /** Receives a network-only label for every tagged request. */
  readonly onTag: (tag: EdgeTag) => void | Promise<void>;
  /**
   * Adds a summary header to the request your app receives, e.g.
   * `realHuman=0.12; verdict=bot; kind=scraper; reasons=ua_bot`. `false` turns it off.
   * Default `'x-realhuman-edge'`.
   */
  readonly forwardHeader?: string | false;
  /** Fraction of requests to tag, 0-1. Default 1. */
  readonly sampleRate?: number;
}

/** Formats a tag for the forwarded request header. */
export function formatTag(tag: EdgeTag): string {
  return `realHuman=${tag.realHuman}; verdict=${tag.verdict}; kind=${tag.kind}; reasons=${tag.reasons.join(',')}`;
}

/**
 * Middleware for `proxy.ts` (`middleware.ts` before Next.js 16) or Vercel Routing Middleware.
 * Labels every request from network evidence alone (including clients that never run
 * JavaScript). It never blocks or changes the response.
 */
export function tagRequests(options: TagRequestsOptions): (request: Request) => Promise<Response> {
  const engine = createRealHuman({ ...options, deliver: 'client' });
  const header = options.forwardHeader === undefined ? 'x-realhuman-edge' : options.forwardHeader;
  const sampleRate = options.sampleRate ?? 1;
  const logger = options.logger ?? console;

  return async (request) => {
    try {
      if (sampleRate < 1 && Math.random() >= sampleRate) return next();
      const tag = await engine.tag(request, trustedFacts(request.headers));

      const deliver = Promise.resolve()
        .then(() => options.onTag(tag))
        .catch((error) => logger.error('[realhuman] onTag failed', error));
      const waitUntilFn = platformWaitUntil();
      if (waitUntilFn) waitUntilFn(deliver);
      else await deliver;

      if (!header) return next();
      const headers = new Headers(request.headers);
      headers.set(header, formatTag(tag));
      return next({ request: { headers } });
    } catch (error) {
      logger.error('[realhuman] tagging failed', error);
      return next();
    }
  };
}
