import * as v from 'valibot';
import {
  AUTOMATION_MARKERS,
  ENGINES,
  HEADLESS_MARKERS,
  KINDS,
  PRIVACY_BROWSERS,
  VERDICTS,
} from './enums.js';
import { REASON_CODES } from './reasons.js';
import { SCHEMA_VERSION } from './version.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

const finite = v.pipe(v.number(), v.finite());
const nonNegative = v.pipe(v.number(), v.finite(), v.minValue(0));
const ratio = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1));
const durationMs = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(DAY_MS));
const count = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_000_000));

/** Random, per-page-load session id. Never stored on the device. */
export const SessionIdSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{16,64}$/));

const NonceSchema = v.pipe(v.string(), v.minLength(16), v.maxLength(512));

/**
 * Join keys you choose to attach (for example an analytics client id).
 * Up to 10 keys; keys are 1-64 safe characters, values at most 256 characters.
 */
export const ContextSchema = v.pipe(
  v.record(
    v.pipe(v.string(), v.regex(/^[A-Za-z0-9_.-]{1,64}$/)),
    v.pipe(v.string(), v.maxLength(256)),
  ),
  v.check((input) => Object.keys(input).length <= 10, 'context may contain at most 10 keys'),
);

// ---------------------------------------------------------------------------
// Signals collected in the browser. Only derived summaries, never raw input.
// ---------------------------------------------------------------------------

export const EnvironmentSignalsSchema = v.object({
  webdriver: v.boolean(),
  automationMarkers: v.pipe(v.array(v.picklist(AUTOMATION_MARKERS)), v.maxLength(16)),
  headlessMarkers: v.pipe(v.array(v.picklist(HEADLESS_MARKERS)), v.maxLength(16)),
  /** null when WebGL is unavailable. */
  softwareRenderer: v.nullable(v.boolean()),
  /** null when the browser does not support User-Agent Client Hints. */
  uaClientHintsMismatch: v.nullable(v.boolean()),
  /** null when the Worker check could not run (for example blocked by CSP). */
  workerMismatch: v.nullable(v.boolean()),
  featureMismatch: v.nullable(v.boolean()),
  nativeTamper: v.boolean(),
  privacyBrowser: v.nullable(v.picklist(PRIVACY_BROWSERS)),
  /** IANA time zone name, for example "Europe/London". */
  timezone: v.nullable(v.pipe(v.string(), v.maxLength(64))),
  maxTouchPoints: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(64)),
});

export const PointerSignalsSchema = v.object({
  events: count,
  trustedRatio: ratio,
  coalescedPerMove: nonNegative,
  speedMean: nonNegative,
  speedCv: nonNegative,
  accelerationCv: nonNegative,
  curvatureMean: nonNegative,
  straightRatio: ratio,
  pauses: count,
  clicks: count,
  teleportClicks: count,
  centerClicks: count,
  pointerTypes: v.object({ mouse: count, pen: count, touch: count }),
  pressureVariance: v.nullable(nonNegative),
});

export const KeyboardSignalsSchema = v.object({
  events: count,
  trustedRatio: ratio,
  holdMeanMs: durationMs,
  holdCv: nonNegative,
  gapMeanMs: durationMs,
  gapCv: nonNegative,
  pastes: count,
  /** Counts per key class. Key values are never recorded. */
  keyClasses: v.object({ character: count, editing: count, navigation: count, modifier: count }),
});

export const TouchSignalsSchema = v.object({
  events: count,
  trustedRatio: ratio,
  radiusVariance: v.nullable(nonNegative),
  forceVariance: v.nullable(nonNegative),
  multiTouch: count,
  tapMeanMs: durationMs,
});

export const ScrollSignalsSchema = v.object({
  events: count,
  wheelEvents: count,
  deltaModes: v.object({ pixel: count, line: count, page: count }),
  quantizedRatio: ratio,
  cadenceCv: nonNegative,
});

export const TimingSignalsSchema = v.object({
  firstInteractionMs: v.nullable(durationMs),
  rafJitterMs: nonNegative,
  eventLoopLagMs: nonNegative,
  /** Difference between wall-clock and monotonic elapsed time. Large values suggest a manipulated clock. */
  clockDriftMs: finite,
  visibilityChanges: count,
  focusChanges: count,
  domContentLoadedMs: v.nullable(durationMs),
});

export const HoneypotSignalsSchema = v.object({
  fields: count,
  filled: count,
  trapFollowed: v.boolean(),
  canaryFollowed: v.boolean(),
  fastSubmits: count,
  syntheticClicks: count,
});

/** Every signal group. A group is null when its collector is switched off or unsupported. */
export const SignalsSchema = v.object({
  env: EnvironmentSignalsSchema,
  pointer: v.nullable(PointerSignalsSchema),
  keyboard: v.nullable(KeyboardSignalsSchema),
  touch: v.nullable(TouchSignalsSchema),
  scroll: v.nullable(ScrollSignalsSchema),
  timing: TimingSignalsSchema,
  honeypot: v.nullable(HoneypotSignalsSchema),
});

// ---------------------------------------------------------------------------
// HTTP: GET {endpoint}/init and POST {endpoint}/score
// ---------------------------------------------------------------------------

/** Response body of `GET {endpoint}/init`. */
export const InitResponseSchema = v.object({
  v: v.literal(SCHEMA_VERSION),
  sid: SessionIdSchema,
  nonce: NonceSchema,
  /** Unix epoch milliseconds after which the nonce is rejected. */
  expiresAt: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

/** Request body of `POST {endpoint}/score`. */
export const PayloadSchema = v.object({
  v: v.literal(SCHEMA_VERSION),
  sid: SessionIdSchema,
  /** 0 for the first update of a page load, then 1, 2, 3... The highest seq wins. */
  seq: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)),
  /** true when sent while the page is closing. Not guaranteed to arrive. */
  final: v.boolean(),
  nonce: NonceSchema,
  /** Monotonic milliseconds since the SDK started. */
  elapsedMs: durationMs,
  /** Wall-clock milliseconds since the SDK started. */
  wallElapsedMs: finite,
  /** Monotonic milliseconds since the client received the current nonce. */
  nonceAgeMs: durationMs,
  context: ContextSchema,
  signals: SignalsSchema,
});

/**
 * Response body of `POST {endpoint}/score` when the delivery mode is `client` or `both`.
 * Fields not listed in `clientFields` are omitted. In `server` mode the response is 204 with no body.
 */
export const ClientResultSchema = v.object({
  v: v.literal(SCHEMA_VERSION),
  sid: SessionIdSchema,
  seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  realHuman: v.optional(ratio),
  verdict: v.optional(v.picklist(VERDICTS)),
  kind: v.optional(v.picklist(KINDS)),
  confidence: v.optional(ratio),
});

// ---------------------------------------------------------------------------
// Decision record: what your backend ingests via onDecision
// ---------------------------------------------------------------------------

/** Facts read at the edge from the TLS connection and HTTP headers. */
export const ServerFactsSchema = v.object({
  /** JA4 TLS client fingerprint as supplied by the CDN, or null if unavailable. */
  ja4: v.nullable(v.pipe(v.string(), v.maxLength(64))),
  /** Browser family parsed from the user agent, for example "chrome". Never the raw string. */
  uaFamily: v.nullable(v.pipe(v.string(), v.maxLength(32))),
  uaMajor: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
  platform: v.nullable(v.pipe(v.string(), v.maxLength(32))),
  timezoneMatch: v.nullable(v.boolean()),
  secFetchPresent: v.boolean(),
  clientHintsPresent: v.boolean(),
  /** Do the Client Hints headers contradict the user agent? null when hints are absent. */
  clientHintsMismatch: v.nullable(v.boolean()),
  /** Agent name from a valid Web Bot Auth signature, if any. */
  verifiedAgent: v.nullable(v.pipe(v.string(), v.maxLength(128))),
});

export const ShadowResultSchema = v.object({
  engine: v.picklist(ENGINES),
  realHuman: ratio,
  verdict: v.picklist(VERDICTS),
  reasons: v.array(v.picklist(REASON_CODES)),
});

export const DecisionRecordSchema = v.object({
  v: v.literal(SCHEMA_VERSION),
  sid: SessionIdSchema,
  seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  final: v.boolean(),
  /** ISO 8601 timestamp of when the server made the decision. */
  ts: v.pipe(v.string(), v.isoTimestamp()),
  realHuman: ratio,
  verdict: v.picklist(VERDICTS),
  kind: v.picklist(KINDS),
  confidence: ratio,
  reasons: v.array(v.picklist(REASON_CODES)),
  engine: v.picklist(ENGINES),
  engineVersion: v.pipe(v.string(), v.maxLength(32)),
  model: v.optional(v.pipe(v.string(), v.maxLength(128))),
  provider: v.optional(v.pipe(v.string(), v.maxLength(64))),
  questionsVersion: v.optional(v.pipe(v.string(), v.maxLength(32))),
  /** Present when shadow mode ran a second engine on the same session. */
  shadow: v.optional(ShadowResultSchema),
  server: ServerFactsSchema,
  /** null for sessions that never ran the browser SDK (kind: "no_js"). */
  signals: v.nullable(SignalsSchema),
  context: ContextSchema,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Context = v.InferOutput<typeof ContextSchema>;
export type EnvironmentSignals = v.InferOutput<typeof EnvironmentSignalsSchema>;
export type PointerSignals = v.InferOutput<typeof PointerSignalsSchema>;
export type KeyboardSignals = v.InferOutput<typeof KeyboardSignalsSchema>;
export type TouchSignals = v.InferOutput<typeof TouchSignalsSchema>;
export type ScrollSignals = v.InferOutput<typeof ScrollSignalsSchema>;
export type TimingSignals = v.InferOutput<typeof TimingSignalsSchema>;
export type HoneypotSignals = v.InferOutput<typeof HoneypotSignalsSchema>;
export type Signals = v.InferOutput<typeof SignalsSchema>;
export type InitResponse = v.InferOutput<typeof InitResponseSchema>;
export type Payload = v.InferOutput<typeof PayloadSchema>;
export type ClientResult = v.InferOutput<typeof ClientResultSchema>;
export type ServerFacts = v.InferOutput<typeof ServerFactsSchema>;
export type ShadowResult = v.InferOutput<typeof ShadowResultSchema>;
export type DecisionRecord = v.InferOutput<typeof DecisionRecordSchema>;
