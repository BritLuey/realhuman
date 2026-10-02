import type { ClientResult, Payload, Signals } from '@realhuman/schema';
import { type Honeypots, honeypots } from './honeypot.js';
import { sha256Hex } from './sha256.js';
import { type EnvProbe, NEUTRAL_ENV, probeEnvironment } from './signals/env.js';
import { collectKeyboard, collectScroll, collectTouch } from './signals/input.js';
import { collectPointer } from './signals/pointer.js';
import { collectTiming, domContentLoaded, timingStats } from './signals/timing.js';
import type { ContextValue, RealHumanInstance, RealHumanOptions } from './types.js';
import { now, type Scope, scope, toJson } from './util.js';

export const DEFAULT_ENDPOINT = '/api/realhuman';
export const DEFAULT_FLUSH_MS = 1000;
const MAX_SEQ = 1000;
/** Refresh the nonce when it has less than this left. */
const REFRESH_MARGIN_MS = 60_000;
/** Assumed nonce lifetime when the device clock makes `expiresAt` unusable (server default). */
const FALLBACK_TTL_MS = 900_000;
const INIT_RETRY_MS = 2000;
/** Longest wait for the asynchronous environment checks before the first update. */
const ENV_WAIT_MS = 1500;
const CONTEXT_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

/** Keeps at most 10 valid entries: safe keys and string values up to 256 characters. */
export const cleanContext = (input: unknown): ContextValue =>
  Object.fromEntries(
    Object.entries(input && typeof input === 'object' ? input : {})
      .filter(([k, v]) => CONTEXT_KEY.test(k) && typeof v === 'string' && v.length <= 256)
      .slice(0, 10),
  );

const clampFlush = (value: number | undefined): number =>
  typeof value === 'number' && value >= 0
    ? Math.min(60_000, Math.max(250, value))
    : DEFAULT_FLUSH_MS;

const isResult = (r: unknown): r is ClientResult =>
  (r as ClientResult | null)?.v === 1 && typeof (r as ClientResult).sid === 'string';

interface Collectors {
  readonly signals: () => Signals;
  readonly env: EnvProbe | null;
}

function startCollectors(
  s: Scope,
  o: RealHumanOptions,
  hp: Honeypots | null,
  start: number,
  wall: number,
): Collectors {
  const c = o.collectors ?? {};
  const pointer = c.pointer !== false ? collectPointer(s) : null;
  const keyboard = c.keyboard !== false ? collectKeyboard(s) : null;
  const touch = c.touch !== false ? collectTouch(s) : null;
  const scroll = c.scroll !== false ? collectScroll(s) : null;
  const timing = c.timing !== false ? collectTiming(s, start) : null;
  const env = c.environment !== false ? probeEnvironment(s) : null;
  return {
    env,
    signals: () => ({
      env: env ? env.snapshot() : NEUTRAL_ENV,
      pointer: pointer?.summary() ?? null,
      keyboard: keyboard?.summary() ?? null,
      touch: touch?.summary() ?? null,
      scroll: scroll?.summary() ?? null,
      timing: timing
        ? timing.summary(now() - start, Date.now() - wall, domContentLoaded())
        : // Disabled: an empty summary (no interaction, zero jitter, lag and drift).
          timingStats(0).summary(0, 0, null),
      honeypot: hp?.summary() ?? null,
    }),
  };
}

/** Creates a live SDK instance. Use `init()` instead, which handles SSR and duplicates. */
export function createClient(o: RealHumanOptions, onDestroy: () => void): RealHumanInstance {
  const endpoint = (o.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
  const flushAfter = clampFlush(o.flushAfterMs);
  const log: (...args: unknown[]) => void = o.debug
    ? (...args) => console.log('[realhuman]', ...args)
    : () => {};
  const s = scope(log);
  const listeners = new Set<(r: ClientResult) => void>();
  const pending: HTMLFormElement[] = [];

  let sid = '';
  let nonce = '';
  let nonceAt = 0;
  let ttl = FALLBACK_TTL_MS;
  let seq = 0;
  let start = 0;
  let wall = 0;
  let started = false;
  let destroyed = false;
  let finalSent = false;
  let session: Promise<boolean> = Promise.resolve(false);
  let collectors: Collectors | null = null;
  let hp: Honeypots | null = null;
  let resolveReady: (r: ClientResult | null) => void = () => {};
  const ready = new Promise<ClientResult | null>((resolve) => {
    resolveReady = resolve;
  });

  const delay = (time: number) => new Promise<void>((resolve) => s.wait(resolve, time));
  const nonceAge = () => now() - nonceAt;

  async function fetchNonce(refresh?: string): Promise<void> {
    const query = refresh ? `?refresh=${encodeURIComponent(refresh)}` : '';
    const response = await fetch(`${endpoint}/init${query}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const body = (await response.json()) as { sid?: unknown; nonce?: unknown; expiresAt?: unknown };
    if (
      !response.ok ||
      typeof body.sid !== 'string' ||
      typeof body.nonce !== 'string' ||
      typeof body.expiresAt !== 'number'
    ) {
      throw new Error(`init ${response.status}`);
    }
    if (destroyed) return;
    sid = body.sid;
    nonce = body.nonce;
    nonceAt = now();
    const remaining = body.expiresAt - Date.now();
    ttl = remaining > 0 ? remaining : FALLBACK_TTL_MS;
    hp?.session(sid, nonce);
    log('session', sid);
  }

  function deliver(result: ClientResult) {
    log('result', result);
    const call = s.safe((fn: () => void) => fn());
    call(() => o.onResult?.(result));
    for (const fn of listeners) call(() => fn(result));
    for (const integration of o.integrations ?? []) {
      call(() => integration.onResult(result, instance));
    }
    call(() => window.dispatchEvent(new CustomEvent('realhuman:result', { detail: result })));
  }

  async function send(final: boolean): Promise<ClientResult | null> {
    let result: ClientResult | null = null;
    let current = -1;
    try {
      if (!started || destroyed) return null;
      if (!final && (await session)) {
        await Promise.race([collectors?.env?.ready, delay(ENV_WAIT_MS)]);
        if (nonceAge() > ttl - REFRESH_MARGIN_MS) await fetchNonce(nonce).catch(log);
      }
      // No session yet (a closing page can't wait for one), or an expired nonce, which would
      // be scored as a bot: stay silent instead.
      if (!sid || nonceAge() > ttl || destroyed || seq > MAX_SEQ) return null;
      current = seq++;
      const t = now();
      const payload: Payload = {
        v: 1,
        sid,
        seq: current,
        final,
        nonce,
        elapsedMs: t - start,
        wallElapsedMs: Date.now() - wall,
        nonceAgeMs: Math.max(0, t - nonceAt),
        context: cleanContext(typeof o.context === 'function' ? o.context() : o.context),
        signals: (collectors as Collectors).signals(),
      };
      const body = toJson(payload);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (o.awsContentHash) headers['x-amz-content-sha256'] = sha256Hex(body);
      log('update', current, final, body.length, payload);
      const request = fetch(`${endpoint}/score`, {
        method: 'POST',
        headers,
        body,
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: final,
      });
      if (final) {
        // Nobody is left to receive a result.
        finalSent = true;
        request.catch(log);
      } else {
        const response = await request;
        log('response', current, response.status);
        const json: unknown = response.status === 200 ? await response.json() : null;
        if (isResult(json) && !destroyed) {
          result = json;
          deliver(json);
        }
      }
    } catch (error) {
      log(error);
    } finally {
      // `ready` settles with seq 0, or with null once it is clear seq 0 won't produce a result.
      if (started && (current === 0 || (seq === 0 && !final))) resolveReady(result);
    }
    return result;
  }

  function begin() {
    if (started || destroyed) return;
    started = true;
    start = now();
    wall = Date.now();
    if (o.honeypot !== false) hp = honeypots(s, o.honeypot ?? {}, endpoint, log);
    collectors = startCollectors(s, o, hp, start, wall);
    for (const form of pending.splice(0)) hp?.attach(form);

    session = fetchNonce()
      .catch(async (error) => {
        log(error);
        await delay(INIT_RETRY_MS);
        await fetchNonce();
      })
      .then(
        () => !destroyed,
        (error: unknown) => {
          log(error);
          return false;
        },
      );
    s.wait(() => void send(false), flushAfter);

    const hide = () => {
      if (o.sendOnPageHide !== false && !finalSent) void send(true);
    };
    s.on(window, 'pagehide', hide);
    s.on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') hide();
    });
  }

  const instance: RealHumanInstance = {
    get sid() {
      return sid;
    },
    ready,
    score: () => send(false),
    on(_event, fn) {
      listeners.add(fn);
    },
    off(_event, fn) {
      listeners.delete(fn);
    },
    attach(form) {
      if (destroyed || o.honeypot === false) return;
      if (hp) s.safe(hp.attach)(form);
      else pending.push(form);
    },
    grantConsent: s.safe(begin),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      s.stop();
      hp?.remove();
      listeners.clear();
      resolveReady(null);
      onDestroy();
      log('destroyed');
    },
  };

  if (o.consent !== false) s.safe(begin)();
  return instance;
}
