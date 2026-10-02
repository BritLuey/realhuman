import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIELD_PREFIX, type Honeypots, HP_ATTR, honeypots } from '../src/honeypot.js';
import type { HoneypotOptions } from '../src/types.js';
import { type Scope, scope } from '../src/util.js';

let s: Scope;
let hp: Honeypots | undefined;

function start(options: HoneypotOptions = {}): Honeypots {
  hp = honeypots(s, options, '/api/realhuman', () => {});
  return hp;
}

function addForm(attrs = 'data-realhuman'): HTMLFormElement {
  const form = document.createElement('form');
  if (attrs) form.setAttribute(attrs, '');
  form.innerHTML = '<input name="email"><button type="submit">Go</button>';
  document.body.append(form);
  return form;
}

const submit = (form: HTMLFormElement) =>
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'performance',
      'requestIdleCallback',
      'cancelIdleCallback',
    ],
  });
  s = scope(() => {});
});

afterEach(() => {
  s.stop();
  hp?.remove();
  hp = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('hidden field', () => {
  it('is injected into matching forms with the anti-autofill attributes', async () => {
    const form = addForm();
    const plain = addForm('');
    start();
    await vi.advanceTimersByTimeAsync(1100);
    const box = form.querySelector(`[${HP_ATTR}]`) as HTMLElement;
    expect(box).not.toBeNull();
    expect(plain.querySelector(`[${HP_ATTR}]`)).toBeNull();
    expect(box.getAttribute('aria-hidden')).toBe('true');
    expect(box.hasAttribute('inert')).toBe(true);
    expect(box.hasAttribute('style')).toBe(true); // set via the CSSOM
    expect(box.style.getPropertyValue('position')).toBe('absolute');
    expect(box.style.getPropertyValue('left')).toBe('-10000px');
    const input = box.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.name).toMatch(new RegExp(`^${FIELD_PREFIX}[0-9a-z]{6}$`));
    expect(input.getAttribute('tabindex')).toBe('-1');
    expect(input.getAttribute('autocomplete')).toMatch(/^off-[0-9a-z]{6}$/);
    expect(input.hasAttribute('data-1p-ignore')).toBe(true);
    expect(input.getAttribute('data-lpignore')).toBe('true');
    expect(input.hasAttribute('data-bwignore')).toBe(true);
    expect(input.getAttribute('data-form-type')).toBe('other');
    expect(hp?.summary()).toMatchObject({ fields: 1, filled: 0 });
  });

  it('uses a different random name for each field', async () => {
    addForm();
    addForm();
    start();
    await vi.advanceTimersByTimeAsync(1100);
    const names = [...document.querySelectorAll(`[${HP_ATTR}] input`)].map(
      (i) => (i as HTMLInputElement).name,
    );
    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
  });

  it('attach() protects a specific form once, and forms: false disables scanning', async () => {
    addForm();
    const custom = addForm('');
    const h = start({ forms: false });
    h.attach(custom);
    h.attach(custom);
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.querySelectorAll(`[${HP_ATTR}]`)).toHaveLength(1);
    expect(custom.querySelector(`[${HP_ATTR}]`)).not.toBeNull();
  });

  it('finds forms added later', async () => {
    start();
    await vi.advanceTimersByTimeAsync(1100);
    const later = addForm();
    await vi.advanceTimersByTimeAsync(1100);
    expect(later.querySelector(`[${HP_ATTR}]`)).not.toBeNull();
    expect(hp?.summary().fields).toBe(1);
  });

  it('counts filled fields', async () => {
    const form = addForm();
    start();
    await vi.advanceTimersByTimeAsync(1100);
    (document.querySelector(`[${HP_ATTR}] input`) as HTMLInputElement).value = 'test';
    expect(hp?.summary().filled).toBe(1);
    // Still counted after the form is reset.
    form.reset();
    (document.querySelector(`[${HP_ATTR}] input`) as HTMLInputElement).value = '';
    expect(hp?.summary().filled).toBe(1);
  });

  it('remove() takes everything out', async () => {
    addForm();
    start({ trapLink: true, agentCanary: true });
    await vi.advanceTimersByTimeAsync(1100);
    expect(document.querySelectorAll(`[${HP_ATTR}]`)).toHaveLength(3);
    hp?.remove();
    expect(document.querySelectorAll(`[${HP_ATTR}]`)).toHaveLength(0);
  });
});

describe('time trap', () => {
  it('counts forms submitted faster than minFillMs', async () => {
    const form = addForm();
    start({ minFillMs: 1500 });
    await vi.advanceTimersByTimeAsync(500);
    const custom = addForm('');
    hp?.attach(custom);
    submit(custom);
    expect(hp?.summary().fastSubmits).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    submit(form);
    submit(custom);
    expect(hp?.summary().fastSubmits).toBe(1);
  });

  it('records a field filled at submit time', async () => {
    const form = addForm();
    start();
    await vi.advanceTimersByTimeAsync(2000);
    const input = form.querySelector(`[${HP_ATTR}] input`) as HTMLInputElement;
    input.value = 'bot';
    submit(form);
    input.value = '';
    expect(hp?.summary().filled).toBe(1);
  });
});

describe('trap link', () => {
  it('points at the trap endpoint and records a followed link', () => {
    start({ trapLink: true });
    const link = document.querySelector(`a[${HP_ATTR}]`) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBeNull();
    expect(link.rel).toBe('nofollow noopener');
    expect(link.getAttribute('aria-hidden')).toBe('true');
    expect(link.hasAttribute('inert')).toBe(true);
    expect(link.getAttribute('tabindex')).toBe('-1');
    hp?.session('k3J9x0aQ2mW8pL5rT7yB', 'v1.a+b/c=');
    expect(link.getAttribute('href')).toBe(
      '/api/realhuman/t?s=k3J9x0aQ2mW8pL5rT7yB&n=v1.a%2Bb%2Fc%3D',
    );
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(hp?.summary()).toMatchObject({ trapFollowed: true, syntheticClicks: 1 });
  });

  it('is absent by default', () => {
    start();
    expect(document.querySelector(`a[${HP_ATTR}]`)).toBeNull();
    expect(hp?.summary().trapFollowed).toBe(false);
  });
});

describe('agent canary', () => {
  it('adds hidden instructions and detects a filled verification code', () => {
    start({ agentCanary: true });
    const box = document.querySelector(`[${HP_ATTR}="canary"]`) as HTMLElement;
    expect(box.getAttribute('aria-hidden')).toBe('true');
    expect(box.hasAttribute('inert')).toBe(true);
    expect(box.textContent).toMatch(/AI agents/);
    expect(box.textContent).toMatch(/Verification code/);
    expect(hp?.summary().canaryFollowed).toBe(false);
    (box.querySelector('input') as HTMLInputElement).value = 'abc';
    expect(hp?.summary().canaryFollowed).toBe(true);
    expect(hp?.summary().fields).toBe(0);
  });
});

describe('synthetic clicks', () => {
  it('counts clicks inside honeypot elements only', async () => {
    const form = addForm();
    start();
    await vi.advanceTimersByTimeAsync(1100);
    (form.querySelector('button') as HTMLButtonElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(hp?.summary().syntheticClicks).toBe(0);
    (form.querySelector(`[${HP_ATTR}] input`) as HTMLInputElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(hp?.summary().syntheticClicks).toBe(1);
  });
});
