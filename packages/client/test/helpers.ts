import type { ClientResult } from '@realhuman/schema';
import { vi } from 'vitest';

/** Deterministic pseudo-random numbers, so tests are stable. */
export function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

export const SID = 'k3J9x0aQ2mW8pL5rT7yB';
export const NONCE = 'v1.eyJzaWQiOiJrM0o5eDBhUTJtVzhwTDVyVDd5QiJ9.c2lnbmF0dXJl';

export const result = (seq: number): ClientResult => ({
  v: 1,
  sid: SID,
  seq,
  realHuman: 0.92,
  verdict: 'human',
  confidence: 0.8,
});

export interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

export interface FakeServer {
  readonly calls: Call[];
  readonly scores: () => Call[];
  readonly inits: () => Call[];
  /** Parsed JSON bodies of POST /score requests. */
  readonly payloads: () => Record<string, unknown>[];
  fetch: ReturnType<typeof vi.fn>;
}

interface ServerOptions {
  /** 'client' returns results (200); 'server' returns 204. */
  deliver?: 'client' | 'server';
  /** Lifetime of issued nonces. */
  ttlMs?: number;
  /** Number of initial /init calls that fail. */
  failInit?: number;
  /** Make every request reject (network down). */
  offline?: boolean;
}

/** A fetch mock that behaves like the realHuman endpoint. */
export function fakeServer(options: ServerOptions = {}): FakeServer {
  const calls: Call[] = [];
  let initFailures = options.failInit ?? 0;
  let issued = 0;
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    calls.push({ url: input, init });
    if (options.offline) throw new TypeError('Failed to fetch');
    if (input.includes('/init')) {
      if (initFailures > 0) {
        initFailures--;
        return new Response('oops', { status: 500 });
      }
      issued++;
      return Response.json({
        v: 1,
        sid: SID,
        nonce: `${NONCE}.${issued}`,
        expiresAt: Date.now() + (options.ttlMs ?? 900_000),
      });
    }
    if (input.endsWith('/score')) {
      if (options.deliver === 'server') return new Response(null, { status: 204 });
      const body = JSON.parse(String(init?.body)) as { seq: number };
      return Response.json(result(body.seq));
    }
    return new Response(null, { status: 404 });
  });
  const scores = () => calls.filter((c) => c.url.endsWith('/score'));
  return {
    calls,
    fetch,
    scores,
    inits: () => calls.filter((c) => c.url.includes('/init')),
    payloads: () =>
      scores().map((c) => JSON.parse(String(c.init?.body)) as Record<string, unknown>),
  };
}
