import type { Context } from '@realhuman/schema';
import type { ContextValues, Logger } from './options.js';

/** The same limits the payload schema applies to browser context. */
export const MAX_CONTEXT_KEYS = 10;
export const MAX_CONTEXT_VALUE_LENGTH = 256;
const KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Merges trusted server values over the context the browser sent. Every key the server returns
 * belongs to the server: the browser's value for it is dropped even when the server's value is
 * null or invalid, so a browser can't forge it. Invalid entries are skipped with a warning; if the
 * total exceeds the key limit, browser keys are dropped first.
 */
export function mergeContext(
  browser: Context,
  server: ContextValues | undefined,
  logger: Logger,
): Context {
  if (!server) return browser;
  const trusted: Record<string, string> = {};
  const owned = new Set(Object.keys(server));
  for (const [key, raw] of Object.entries(server)) {
    if (raw === undefined || raw === null) continue;
    const value = typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : raw;
    if (
      !KEY_PATTERN.test(key) ||
      typeof value !== 'string' ||
      value.length > MAX_CONTEXT_VALUE_LENGTH
    ) {
      logger.warn(
        `[realhuman] serverContext key '${key}' was skipped: keys must match ${KEY_PATTERN} and values be strings of at most ${MAX_CONTEXT_VALUE_LENGTH} characters.`,
      );
      continue;
    }
    trusted[key] = value;
  }

  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(browser)) if (!owned.has(key)) merged[key] = value;
  Object.assign(merged, trusted);
  for (const key of Object.keys(browser)) {
    if (Object.keys(merged).length <= MAX_CONTEXT_KEYS) break;
    if (!(key in trusted)) delete merged[key];
  }
  if (Object.keys(merged).length > MAX_CONTEXT_KEYS) {
    logger.warn(
      `[realhuman] serverContext returned more than ${MAX_CONTEXT_KEYS} keys; extra keys were dropped.`,
    );
    return Object.fromEntries(Object.entries(merged).slice(0, MAX_CONTEXT_KEYS));
  }
  return merged;
}
