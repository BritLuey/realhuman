import { createHash } from 'node:crypto';
import { type ClientResult, parsePayload } from '@realhuman/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanContext } from '../src/client.js';
import { HP_ATTR } from '../src/honeypot.js';
import { type Integration, init, type RealHumanInstance } from '../src/index.js';
import { type FakeServer, fakeServer, NONCE, result, SID } from './helpers.js';

let server: FakeServer;
let rh: RealHumanInstance | undefined;

function serve(options: Parameters<typeof fakeServer>[0] = {}) {
  server = fakeServer(options);
  vi.stubGlobal('fetch', server.fetch);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'Date',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
    ],
  });
  serve();
});

afterEach(() => {
  rh?.destroy();
  rh = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Lets the flush timer fire and every pending request settle. */
const settle = (ms = 3000) => vi.advanceTimersByTimeAsync(ms);

describe('start-up and the first update', () => {
  it('fetches a session, then sends seq 0 after flushAfterMs', async () => {
    rh = init();
    expect(rh.sid).toBe('');
    await vi.advanceTimersByTimeAsync(10);
    expect(server.inits()).toHaveLength(1);
    expect(server.inits()[0]?.url).toBe('/api/realhuman/init');
    expect(server.inits()[0]?.init).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(rh.sid).toBe(SID);
    await vi.advanceTimersByTimeAsync(900);
    expect(server.scores()).toHaveLength(0);
    await settle();
    expect(server.scores()).toHaveLength(1);
    const call = server.scores()[0];
    expect(call?.url).toBe('/api/realhuman/score');
    expect(call?.init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      keepalive: false,
    });
    expect(server.payloads()[0]).toMatchObject({
      v: 1,
      sid: SID,
      seq: 0,
      final: false,
      nonce: `${NONCE}.1`,
    });
    await expect(rh.ready).resolves.toEqual(result(0));
  });

  it('sends a payload that the schema accepts, with every signal group', async () => {
    rh = init({
      honeypot: { trapLink: true, agentCanary: true },
      context: { gaClientId: '123.456' },
    });
    // Synthetic (untrusted) input, as a script would produce.
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 10, clientY: 10, pointerType: 'mouse' }),
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 20, clientY: 15, pointerType: 'mouse' }),
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA' }));
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    await settle();
    const payload = server.payloads()[0];
    const parsed = parsePayload(payload);
    expect(parsed.success ? [] : parsed.issues).toEqual([]);
    expect(payload).toMatchObject({ context: { gaClientId: '123.456' } });
    const signals = (payload as { signals: Record<string, Record<string, unknown>> }).signals;
    expect(signals.pointer).toMatchObject({ events: 2, trustedRatio: 0 });
    expect(signals.keyboard).toMatchObject({ events: 1, trustedRatio: 0 });
    expect(signals.scroll).toMatchObject({ wheelEvents: 1 });
    expect(signals.timing?.firstInteractionMs).not.toBeNull();
    expect(signals.honeypot).toMatchObject({
      fields: 0,
      trapFollowed: false,
      canaryFollowed: false,
    });
    // Raw input never leaves the page.
    expect(JSON.stringify(payload)).not.toMatch(/KeyA|"a"|clientX/);
  });

  it('sends null for switched-off groups and neutral env/timing', async () => {
    rh = init({
      honeypot: false,
      collectors: {
        pointer: false,
        keyboard: false,
        touch: false,
        scroll: false,
        environment: false,
        timing: false,
      },
    });
    await settle();
    const payload = server.payloads()[0] as { signals: Record<string, unknown> };
    expect(parsePayload(payload).success).toBe(true);
    expect(payload.signals).toMatchObject({
      pointer: null,
      keyboard: null,
      touch: null,
      scroll: null,
      honeypot: null,
    });
    expect(payload.signals.env).toMatchObject({
      webdriver: false,
      automationMarkers: [],
      timezone: null,
    });
    expect(payload.signals.timing).toMatchObject({
      firstInteractionMs: null,
      domContentLoadedMs: null,
    });
  });

  it('clamps flushAfterMs and strips trailing slashes from the endpoint', async () => {
    rh = init({ flushAfterMs: 1, endpoint: 'https://example.com/rh/' });
    await vi.advanceTimersByTimeAsync(10);
    expect(server.inits()[0]?.url).toBe('https://example.com/rh/init');
    await vi.advanceTimersByTimeAsync(100);
    expect(server.scores()).toHaveLength(0);
    await settle();
    expect(server.scores()).toHaveLength(1);
  });

  it('retries /init once after 2 s', async () => {
    serve({ failInit: 1 });
    rh = init();
    await settle(5000);
    expect(server.inits()).toHaveLength(2);
    expect(server.scores()).toHaveLength(1);
    await expect(rh.ready).resolves.toEqual(result(0));
  });

  it('stays silent when /init keeps failing', async () => {
    serve({ failInit: 5 });
    rh = init();
    await settle(5000);
    expect(server.inits()).toHaveLength(2);
    expect(server.scores()).toHaveLength(0);
    await expect(rh.ready).resolves.toBeNull();
    await expect(rh.score()).resolves.toBeNull();
  });

  it('never throws when the network is down', async () => {
    serve({ offline: true });
    rh = init({ debug: false });
    await settle(5000);
    await expect(rh.ready).resolves.toBeNull();
    await expect(rh.score()).resolves.toBeNull();
  });
});

describe('updates and results', () => {
  it('increments seq on score()', async () => {
    rh = init();
    await settle();
    await expect(rh.score()).resolves.toEqual(result(1));
    const pending = rh.score();
    await settle();
    await expect(pending).resolves.toEqual(result(2));
    expect(server.payloads().map((p) => p.seq)).toEqual([0, 1, 2]);
  });

  it('delivers results to onResult, on(), integrations and a DOM event', async () => {
    const onResult = vi.fn();
    const listener = vi.fn();
    const removed = vi.fn();
    const integration: Integration = { name: 'test', onResult: vi.fn() };
    const domEvents: ClientResult[] = [];
    const onDom = (e: Event) => domEvents.push((e as CustomEvent<ClientResult>).detail);
    window.addEventListener('realhuman:result', onDom);
    rh = init({ onResult, integrations: [integration] });
    rh.on('result', listener);
    rh.on('result', removed);
    rh.off('result', removed);
    await settle();
    window.removeEventListener('realhuman:result', onDom);
    expect(onResult).toHaveBeenCalledWith(result(0));
    expect(listener).toHaveBeenCalledWith(result(0));
    expect(removed).not.toHaveBeenCalled();
    expect(integration.onResult).toHaveBeenCalledWith(result(0), rh);
    expect(domEvents).toEqual([result(0)]);
  });

  it('isolates a throwing callback', async () => {
    const after = vi.fn();
    rh = init({
      onResult: () => {
        throw new Error('host bug');
      },
      integrations: [
        {
          name: 'broken',
          onResult: () => {
            throw new Error('integration bug');
          },
        },
      ],
    });
    rh.on('result', after);
    await settle();
    expect(after).toHaveBeenCalledOnce();
  });

  it('resolves null for 204 (server delivery mode)', async () => {
    serve({ deliver: 'server' });
    const onResult = vi.fn();
    rh = init({ onResult });
    await settle();
    await expect(rh.ready).resolves.toBeNull();
    await expect(rh.score()).resolves.toBeNull();
    expect(onResult).not.toHaveBeenCalled();
    expect(server.scores()).toHaveLength(2);
  });

  it('stops after seq 1000', async () => {
    serve({ deliver: 'server' });
    rh = init();
    await settle();
    for (let i = 1; i <= 1000; i++) await rh.score();
    expect(server.scores()).toHaveLength(1001);
    await rh.score();
    expect(server.scores()).toHaveLength(1001);
    expect(server.payloads().at(-1)?.seq).toBe(1000);
  });

  it('calls the context function for each update and drops invalid entries', async () => {
    let n = 0;
    rh = init({ context: () => ({ visit: String(++n), 'bad key': 'x' }) });
    await settle();
    await rh.score();
    expect(server.payloads().map((p) => p.context)).toEqual([{ visit: '1' }, { visit: '2' }]);
  });

  it('setContext adds values to later updates, overrides the option, and null removes', async () => {
    rh = init({ context: { gaClientId: '123.456', plan: 'free' } });
    await settle();
    rh.setContext({ userId: 'user_42', plan: 'pro' });
    await rh.score();
    rh.setContext({ userId: null });
    await rh.score();
    expect(server.payloads().map((p) => p.context)).toEqual([
      { gaClientId: '123.456', plan: 'free' },
      { gaClientId: '123.456', plan: 'pro', userId: 'user_42' },
      { gaClientId: '123.456', plan: 'pro' },
    ]);
  });

  it('keeps sending if the context function throws', async () => {
    rh = init({
      context: () => {
        throw new Error('analytics not ready');
      },
    });
    rh.setContext({ userId: 'user_42' });
    await settle();
    expect(server.payloads()[0]?.context).toEqual({ userId: 'user_42' });
  });
});

describe('cleanContext', () => {
  it('enforces key format, value length and at most 10 keys', () => {
    const input: Record<string, unknown> = {
      ok: 'yes',
      'no spaces': 'x',
      long: 'x'.repeat(257),
      num: 5,
    };
    for (let i = 0; i < 12; i++) input[`k${i}`] = String(i);
    const out = cleanContext(input);
    expect(Object.keys(out)).toHaveLength(10);
    expect(out.ok).toBe('yes');
    expect(out).not.toHaveProperty('long');
    expect(out).not.toHaveProperty('num');
    expect(cleanContext(undefined)).toEqual({});
    expect(cleanContext('nope')).toEqual({});
  });
});

describe('nonce refresh', () => {
  it('refreshes a nonce that is about to expire, keeping the session', async () => {
    serve({ ttlMs: 60_500 });
    rh = init();
    await settle();
    const inits = server.inits();
    expect(inits).toHaveLength(2);
    expect(inits[1]?.url).toBe(`/api/realhuman/init?refresh=${encodeURIComponent(`${NONCE}.1`)}`);
    expect(server.payloads()[0]).toMatchObject({ sid: SID, nonce: `${NONCE}.2` });
    const age = server.payloads()[0]?.nonceAgeMs as number;
    expect(age).toBeLessThan(100);
  });

  it('does not refresh a fresh nonce', async () => {
    rh = init();
    await settle();
    expect(server.inits()).toHaveLength(1);
    expect(server.payloads()[0]?.nonceAgeMs).toBeGreaterThan(900);
  });
});

describe('final update on page hide', () => {
  it('sends one final update with keepalive', async () => {
    rh = init();
    await settle();
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await settle();
    const finals = server.scores().filter((c) => c.init?.keepalive);
    expect(finals).toHaveLength(1);
    expect(server.payloads()[1]).toMatchObject({ seq: 1, final: true });
  });

  it('skips the final update when the nonce has expired (it would be scored as a bot)', async () => {
    rh = init();
    await settle();
    await vi.advanceTimersByTimeAsync(901_000);
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(server.payloads().map((p) => p.final)).toEqual([false]);
  });

  it('sends nothing before a session exists, and honours sendOnPageHide: false', async () => {
    rh = init();
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(server.scores()).toHaveLength(0);
    rh.destroy();
    serve();
    rh = init({ sendOnPageHide: false });
    await settle();
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(server.payloads().map((p) => p.final)).toEqual([false]);
  });
});

describe('AWS content hash', () => {
  it('adds x-amz-content-sha256 matching the exact body', async () => {
    rh = init({ awsContentHash: true, context: { note: 'héllo 🙂' } });
    await settle();
    const call = server.scores()[0];
    const body = String(call?.init?.body);
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers['x-amz-content-sha256']).toBe(
      createHash('sha256').update(body, 'utf8').digest('hex'),
    );
  });

  it('is off by default', async () => {
    rh = init();
    await settle();
    expect(server.scores()[0]?.init?.headers).not.toHaveProperty('x-amz-content-sha256');
  });
});

describe('consent', () => {
  it('collects and sends nothing until grantConsent()', async () => {
    const form = document.createElement('form');
    form.setAttribute('data-realhuman', '');
    document.body.append(form);
    rh = init({ consent: false });
    rh.attach(form);
    await expect(rh.score()).resolves.toBeNull();
    await settle(5000);
    expect(server.calls).toHaveLength(0);
    expect(document.querySelector(`[${HP_ATTR}]`)).toBeNull();
    rh.grantConsent();
    await settle();
    expect(server.inits()).toHaveLength(1);
    expect(server.scores()).toHaveLength(1);
    expect(document.querySelector(`[${HP_ATTR}]`)).not.toBeNull();
    await expect(rh.ready).resolves.toEqual(result(0));
  });
});

describe('lifecycle', () => {
  it('returns the same instance until it is destroyed', () => {
    rh = init();
    expect(init({ debug: true })).toBe(rh);
    rh.destroy();
    const next = init();
    expect(next).not.toBe(rh);
    rh = next;
  });

  it('destroy() stops everything and removes injected elements', async () => {
    const form = document.createElement('form');
    form.setAttribute('data-realhuman', '');
    document.body.append(form);
    rh = init({ honeypot: { trapLink: true } });
    await settle();
    expect(document.querySelectorAll(`[${HP_ATTR}]`).length).toBeGreaterThan(0);
    const calls = server.calls.length;
    rh.destroy();
    expect(document.querySelectorAll(`[${HP_ATTR}]`)).toHaveLength(0);
    await expect(rh.score()).resolves.toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    await settle(10_000);
    expect(server.calls).toHaveLength(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves ready with null when destroyed before the first result', async () => {
    rh = init();
    rh.destroy();
    await expect(rh.ready).resolves.toBeNull();
  });

  it('attach() adds a honeypot to a form outside the selector', async () => {
    rh = init();
    const form = document.createElement('form');
    document.body.append(form);
    rh.attach(form);
    expect(form.querySelector(`[${HP_ATTR}]`)).not.toBeNull();
  });
});
