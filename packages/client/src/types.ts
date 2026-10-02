import type { ClientResult } from '@realhuman/schema';

export type { ClientResult };

/** Join keys copied into decision records. At most 10 keys; invalid entries are dropped. */
export type ContextValue = Record<string, string>;

export interface HoneypotOptions {
  /** CSS selector for forms that get a hidden field. `false` = only forms passed to `attach()`. */
  readonly forms?: string | false;
  /** A form submitted faster than this after it was first shown counts as a time-trap hit. */
  readonly minFillMs?: number;
  /** Add an invisible link that crawlers follow. */
  readonly trapLink?: boolean;
  /** Add hidden instructions that AI agents may act on. */
  readonly agentCanary?: boolean;
}

export interface CollectorOptions {
  readonly pointer?: boolean;
  readonly keyboard?: boolean;
  readonly touch?: boolean;
  readonly scroll?: boolean;
  readonly environment?: boolean;
  readonly timing?: boolean;
}

export interface RealHumanOptions {
  /** Path (or absolute URL) of your server route. Default `'/api/realhuman'`. */
  readonly endpoint?: string;
  /** Milliseconds after start before the first update is sent (250–60000). Default 1000. */
  readonly flushAfterMs?: number;
  /** Send a final update when the page is hidden or closed. Default true. */
  readonly sendOnPageHide?: boolean;
  /** When false, nothing is collected or sent until `grantConsent()`. Default true. */
  readonly consent?: boolean;
  /** Your own join keys, or a function called each time an update is sent. */
  readonly context?: ContextValue | (() => ContextValue);
  /** Honeypot settings. `false` turns honeypots off. */
  readonly honeypot?: false | HoneypotOptions;
  /** Turn individual signal groups off. A switched-off group is sent as `null`. */
  readonly collectors?: CollectorOptions;
  /** Frontend integrations, for example `newRelic()`. */
  readonly integrations?: readonly Integration[];
  /** Called for each result the server returns (`client`/`both` delivery only). */
  readonly onResult?: (result: ClientResult) => void;
  /** Add an `x-amz-content-sha256` header (CloudFront → Lambda function URL with OAC). */
  readonly awsContentHash?: boolean;
  /** Log activity to the browser console. */
  readonly debug?: boolean;
}

export interface RealHumanInstance {
  /** This page load's session id. `''` until the server has issued one. */
  readonly sid: string;
  /** The first result, or `null` in `server` delivery mode or when the network fails. */
  readonly ready: Promise<ClientResult | null>;
  /** Sends an update now. Never throws or rejects; resolves `null` when there is no result. */
  score(): Promise<ClientResult | null>;
  /** Runs `fn` for every result. */
  on(event: 'result', fn: (result: ClientResult) => void): void;
  off(event: 'result', fn: (result: ClientResult) => void): void;
  /** Adds a honeypot field and time trap to this form. */
  attach(form: HTMLFormElement): void;
  /**
   * Adds or changes context values sent with every later update, for example a user id once
   * someone signs in. `null` removes a key. Same limits as the `context` option. Call
   * `score()` afterwards to send the new values straight away.
   */
  setContext(values: Readonly<Record<string, string | null>>): void;
  /** Starts collecting, if initialised with `consent: false`. */
  grantConsent(): void;
  /** Stops collecting and removes every listener, timer, observer and injected element. */
  destroy(): void;
}

/** Passes results to another tool on the page. See docs/guides/frontend-integrations.md. */
export interface Integration {
  readonly name: string;
  onResult(result: ClientResult, instance: RealHumanInstance): void;
}
