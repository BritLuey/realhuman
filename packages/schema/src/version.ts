/**
 * Wire-format version shared by every realHuman payload, response and record.
 *
 * Bumped only for breaking changes to the shape of data on the wire. Additive
 * changes (new optional fields) do not bump it; consumers must ignore unknown
 * fields.
 */
export const SCHEMA_VERSION = 1 as const;

/** Default path prefix the browser SDK talks to. */
export const DEFAULT_ENDPOINT = '/api/realhuman' as const;

/** Default delay, in milliseconds, before the browser SDK sends its first update. */
export const DEFAULT_FLUSH_AFTER_MS = 1000 as const;

/** Hard upper bound on an encoded payload, in bytes. Servers reject anything larger. */
export const MAX_PAYLOAD_BYTES = 16_384 as const;
