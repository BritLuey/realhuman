import type { ReasonCode, ServerFacts, Signals } from '@realhuman/schema';
import { assessJa4, type Ja4Lists, parseJa4 } from './ja4.js';
import type { Analysis, Evidence, EvidenceGroup } from './scorer.js';
import { expectsFetchMetadata, isBrowserFamily } from './ua.js';

export interface AnalysisInput {
  readonly signals: Signals | null;
  readonly server: ServerFacts;
  /** Gates found outside the payload (nonce problems, trap links, declared bot UAs). */
  readonly gates?: readonly ReasonCode[];
  readonly ja4Lists: Ja4Lists;
  /** Raw user agent says "Headless". */
  readonly uaHeadless?: boolean;
}

/**
 * Turns signals and network facts into gates and weighted evidence.
 *
 * Weights are log-odds. They are starting points, documented in docs/reference/reason-codes.md,
 * and are recalibrated by the bot lab before each scoring release.
 */
export const WEIGHTS = {
  webdriver: -4,
  headlessPerMarker: -1.2,
  headlessMax: -3,
  zeroOuterSize: -0.4,
  software_renderer: -1.5,
  ua_client_hints_mismatch: -2.5,
  worker_mismatch: -3,
  feature_mismatch: -2,
  native_tamper: -2.5,
  ua_ja4_mismatch: -3,
  sec_fetch_missing: -2,
  timezone_mismatch: -0.5,
  synthetic_events: -3,
  pointer_linear: -1.5,
  pointer_teleport: -1,
  click_dead_center: -1,
  keyboard_uniform: -1.5,
  form_too_fast: -2,
  pointer_natural: 1.5,
  keyboard_natural: 1.2,
  touch_natural: 1.2,
  scroll_natural: 0.6,
} as const;

/** Reasons that privacy-hardened browsers trigger on purpose, so they're ignored for them. */
const PRIVACY_SUPPRESSED: ReadonlySet<ReasonCode> = new Set([
  'ua_client_hints_mismatch',
  'worker_mismatch',
  'feature_mismatch',
  'native_tamper',
  'software_renderer',
  'timezone_mismatch',
  'headless_markers',
]);

export function analyze(input: AnalysisInput): Analysis {
  const { signals, server } = input;
  const gates = new Set<ReasonCode>(input.gates ?? []);
  const evidence = new Map<ReasonCode, Evidence>();
  const neutral = new Set<ReasonCode>();

  const add = (code: ReasonCode, group: EvidenceGroup, weight: number) => {
    const existing = evidence.get(code);
    // The same code from two sources (e.g. client and server Client Hints checks) counts once.
    if (!existing || Math.abs(weight) > Math.abs(existing.weight))
      evidence.set(code, { code, group, weight });
  };

  const claimsBrowser = isBrowserFamily(server.uaFamily);

  // ── Network ────────────────────────────────────────────────────────────────
  if (server.uaFamily === 'bot') gates.add('ua_bot');
  // No person browses with a headless user agent such as HeadlessChrome.
  if (input.uaHeadless || input.signals?.env.headlessMarkers.includes('ua_headless')) {
    gates.add('ua_bot');
  }

  const ja4 = parseJa4(server.ja4);
  const ja4Assessment = assessJa4(ja4, claimsBrowser, input.ja4Lists);
  if (ja4Assessment === 'non_browser') gates.add('ja4_non_browser');
  else if (ja4Assessment === 'mismatch') add('ua_ja4_mismatch', 'network', WEIGHTS.ua_ja4_mismatch);

  if (
    claimsBrowser &&
    !server.secFetchPresent &&
    expectsFetchMetadata(server.uaFamily, server.uaMajor)
  ) {
    add('sec_fetch_missing', 'network', WEIGHTS.sec_fetch_missing);
  }
  if (server.clientHintsMismatch === true) {
    add('ua_client_hints_mismatch', 'environment', WEIGHTS.ua_client_hints_mismatch);
  }
  if (server.timezoneMatch === false)
    add('timezone_mismatch', 'network', WEIGHTS.timezone_mismatch);
  if (server.verifiedAgent) neutral.add('verified_agent_signature');

  const headlessMarkers = new Set<string>(signals?.env.headlessMarkers ?? []);
  if (input.uaHeadless) headlessMarkers.add('ua_headless');

  // ── Browser environment ───────────────────────────────────────────────────
  let privacyBrowser = false;
  if (signals) {
    const { env } = signals;
    privacyBrowser = env.privacyBrowser !== null;
    if (privacyBrowser) neutral.add('privacy_browser');
    if (env.automationMarkers.length > 0) gates.add('automation_markers');
    if (env.webdriver) add('webdriver', 'environment', WEIGHTS.webdriver);
    if (env.softwareRenderer) add('software_renderer', 'environment', WEIGHTS.software_renderer);
    if (env.uaClientHintsMismatch) {
      add('ua_client_hints_mismatch', 'environment', WEIGHTS.ua_client_hints_mismatch);
    }
    if (env.workerMismatch) add('worker_mismatch', 'environment', WEIGHTS.worker_mismatch);
    if (env.featureMismatch) add('feature_mismatch', 'environment', WEIGHTS.feature_mismatch);
    if (env.nativeTamper) add('native_tamper', 'environment', WEIGHTS.native_tamper);
  }
  // Embedded browsers (desktop apps, iOS/Android in-app browsers) report a zero outer window size
  // for real people, so on its own it's weak evidence, and on mobile it's ignored.
  if (server.platform === 'ios' || server.platform === 'android')
    headlessMarkers.delete('zero_outer_size');
  if (headlessMarkers.size > 0) {
    const strong = [...headlessMarkers].filter((marker) => marker !== 'zero_outer_size').length;
    const weight =
      strong * WEIGHTS.headlessPerMarker +
      (headlessMarkers.has('zero_outer_size') ? WEIGHTS.zeroOuterSize : 0);
    add('headless_markers', 'environment', Math.max(WEIGHTS.headlessMax, weight));
  }

  // ── Honeypots ─────────────────────────────────────────────────────────────
  const honeypot = signals?.honeypot;
  if (honeypot) {
    if (honeypot.filled > 0) gates.add('honeypot_filled');
    if (honeypot.trapFollowed) gates.add('honeypot_trap_followed');
    if (honeypot.canaryFollowed) gates.add('agent_canary_followed');
    if (honeypot.syntheticClicks > 0)
      add('synthetic_events', 'behaviour', WEIGHTS.synthetic_events);
    if (honeypot.fastSubmits > 0) add('form_too_fast', 'behaviour', WEIGHTS.form_too_fast);
  }

  // ── Behaviour ─────────────────────────────────────────────────────────────
  let behaviourCoverage = 0;
  const pointer = signals?.pointer;
  if (pointer && pointer.events > 0) {
    behaviourCoverage += Math.min(1, pointer.events / 40) * 0.4;
    if (pointer.events >= 5 && pointer.trustedRatio < 0.5) {
      add('synthetic_events', 'behaviour', WEIGHTS.synthetic_events);
    }
    if (pointer.events >= 10 && pointer.straightRatio > 0.8 && pointer.speedCv < 0.25) {
      add('pointer_linear', 'behaviour', WEIGHTS.pointer_linear);
    }
    // Click patterns need at least 3 clicks, so one odd click can't count against a person.
    if (pointer.clicks >= 3 && pointer.teleportClicks / pointer.clicks >= 0.5) {
      add('pointer_teleport', 'behaviour', WEIGHTS.pointer_teleport);
    }
    if (pointer.clicks >= 3 && pointer.centerClicks / pointer.clicks >= 0.5) {
      add('click_dead_center', 'behaviour', WEIGHTS.click_dead_center);
    }
    if (
      pointer.events >= 15 &&
      pointer.trustedRatio >= 0.95 &&
      pointer.speedCv > 0.3 &&
      pointer.straightRatio < 0.6 &&
      pointer.curvatureMean > 0.02
    ) {
      add('pointer_natural', 'behaviour', WEIGHTS.pointer_natural);
    }
  }

  const keyboard = signals?.keyboard;
  if (keyboard && keyboard.events > 0) {
    behaviourCoverage += Math.min(1, keyboard.events / 15) * 0.25;
    if (keyboard.events >= 5 && keyboard.trustedRatio < 0.5) {
      add('synthetic_events', 'behaviour', WEIGHTS.synthetic_events);
    }
    if (keyboard.events >= 8 && keyboard.gapCv < 0.12) {
      add('keyboard_uniform', 'behaviour', WEIGHTS.keyboard_uniform);
    }
    if (
      keyboard.events >= 6 &&
      keyboard.trustedRatio >= 0.95 &&
      keyboard.gapCv >= 0.25 &&
      keyboard.holdCv >= 0.1
    ) {
      add('keyboard_natural', 'behaviour', WEIGHTS.keyboard_natural);
    }
  }

  const touch = signals?.touch;
  if (touch && touch.events > 0) {
    behaviourCoverage += Math.min(1, touch.events / 8) * 0.4;
    if (touch.events >= 4 && touch.trustedRatio < 0.5) {
      add('synthetic_events', 'behaviour', WEIGHTS.synthetic_events);
    }
    if (
      touch.events >= 4 &&
      touch.trustedRatio >= 0.95 &&
      ((touch.radiusVariance ?? 0) > 0 || (touch.forceVariance ?? 0) > 0 || touch.tapMeanMs > 30)
    ) {
      add('touch_natural', 'behaviour', WEIGHTS.touch_natural);
    }
  }

  const scroll = signals?.scroll;
  if (scroll && scroll.events > 0) {
    behaviourCoverage += Math.min(1, scroll.events / 10) * 0.15;
    if (scroll.events >= 5 && scroll.cadenceCv >= 0.3 && scroll.quantizedRatio < 0.95) {
      add('scroll_natural', 'behaviour', WEIGHTS.scroll_natural);
    }
  }

  if (!signals) neutral.add('no_js');
  else if (signals.timing.firstInteractionMs === null) neutral.add('no_interaction');

  // ── Privacy browsers: their inconsistencies are deliberate ─────────────────
  if (privacyBrowser) {
    for (const code of PRIVACY_SUPPRESSED) evidence.delete(code);
  }

  const networkCoverage =
    (ja4 ? 0.6 : 0) + (server.uaFamily ? 0.2 : 0) + (server.secFetchPresent ? 0.2 : 0);

  return {
    signals,
    server,
    ja4,
    ja4Assessment,
    gates: [...gates],
    evidence: [...evidence.values()].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
    neutral: [...neutral],
    privacyBrowser,
    coverage: { behaviour: Math.min(1, behaviourCoverage), network: Math.min(1, networkCoverage) },
  };
}
