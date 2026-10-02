import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealHumanProvider, type RealHumanState, useRealHuman } from '../src/index.js';

const SID = 'k3J9x0aQ2mW8pL5rT7yB';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn>;
const seen: RealHumanState[] = [];

function Probe() {
  seen.push(useRealHuman());
  return null;
}

function render(strict: boolean) {
  const tree = createElement(
    RealHumanProvider,
    { options: { flushAfterMs: 250 } },
    createElement(Probe),
  );
  root = createRoot(container);
  act(() => root?.render(strict ? createElement(StrictMode, null, tree) : tree));
}

const initCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/init'));

beforeEach(() => {
  seen.length = 0;
  container = document.createElement('div');
  document.body.append(container);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/init')) {
      return Response.json({
        v: 1,
        sid: SID,
        nonce: 'n'.repeat(24),
        expiresAt: Date.now() + 900_000,
      });
    }
    const { seq } = JSON.parse(String(init?.body)) as { seq: number };
    return Response.json({ v: 1, sid: SID, seq, realHuman: 0.9, verdict: 'human' });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  act(() => root?.unmount());
  root = undefined;
  await new Promise((resolve) => setTimeout(resolve, 5));
  container.remove();
  vi.unstubAllGlobals();
});

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  }
  expect(check()).toBe(true);
};

describe('RealHumanProvider', () => {
  it('starts the SDK and re-renders with each result', async () => {
    render(false);
    expect(seen.at(-1)?.instance).not.toBeNull();
    await waitFor(() => seen.at(-1)?.result !== null);
    expect(seen.at(-1)?.result).toMatchObject({ sid: SID, seq: 0, realHuman: 0.9 });
    const instance = seen.at(-1)?.instance;
    await act(async () => {
      await instance?.score();
    });
    expect(seen.at(-1)?.result).toMatchObject({ seq: 1 });
  });

  it('starts only once under StrictMode', async () => {
    render(true);
    await waitFor(() => seen.at(-1)?.result != null);
    expect(initCalls()).toHaveLength(1);
    const instances = new Set(seen.map((s) => s.instance).filter(Boolean));
    expect(instances.size).toBe(1);
  });

  it('destroys the SDK on unmount', async () => {
    render(false);
    const instance = seen.at(-1)?.instance;
    act(() => root?.unmount());
    root = undefined;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(instance?.score()).resolves.toBeNull();
    await expect(instance?.ready).resolves.toBeNull();
  });
});

describe('useRealHuman', () => {
  it('returns nulls outside a provider', () => {
    root = createRoot(container);
    act(() => root?.render(createElement(Probe)));
    expect(seen.at(-1)).toEqual({ instance: null, result: null });
  });
});
