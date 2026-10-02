import type { DecisionRecord, Payload, Signals } from '../src/index.js';

export function validSignals(): Signals {
  return {
    env: {
      webdriver: false,
      automationMarkers: [],
      headlessMarkers: [],
      softwareRenderer: false,
      uaClientHintsMismatch: false,
      workerMismatch: false,
      featureMismatch: false,
      nativeTamper: false,
      privacyBrowser: null,
      timezone: 'Europe/London',
      maxTouchPoints: 0,
    },
    pointer: {
      events: 84,
      trustedRatio: 1,
      coalescedPerMove: 2.4,
      speedMean: 0.61,
      speedCv: 0.83,
      accelerationCv: 1.9,
      curvatureMean: 0.22,
      straightRatio: 0.08,
      pauses: 3,
      clicks: 1,
      teleportClicks: 0,
      centerClicks: 0,
      pointerTypes: { mouse: 84, pen: 0, touch: 0 },
      pressureVariance: null,
    },
    keyboard: null,
    touch: null,
    scroll: {
      events: 12,
      wheelEvents: 12,
      deltaModes: { pixel: 12, line: 0, page: 0 },
      quantizedRatio: 0.1,
      cadenceCv: 0.7,
    },
    timing: {
      firstInteractionMs: 340,
      rafJitterMs: 1.2,
      eventLoopLagMs: 3.5,
      clockDriftMs: 0.4,
      visibilityChanges: 0,
      focusChanges: 0,
      domContentLoadedMs: 210,
    },
    honeypot: {
      fields: 1,
      filled: 0,
      trapFollowed: false,
      canaryFollowed: false,
      fastSubmits: 0,
      syntheticClicks: 0,
    },
  };
}

export function validPayload(): Payload {
  return {
    v: 1,
    sid: 'k3J9x0aQ2mW8pL5rT7yB',
    seq: 0,
    final: false,
    nonce: 'v1.eyJzaWQiOiJrM0o5eDBhUTJtVzhwTDVyVDd5QiJ9.c2lnbmF0dXJl',
    elapsedMs: 1003.4,
    wallElapsedMs: 1003,
    nonceAgeMs: 940,
    context: { gaClientId: '1234567890.1700000000' },
    signals: validSignals(),
  };
}

export function validRecord(): DecisionRecord {
  return {
    v: 1,
    sid: 'k3J9x0aQ2mW8pL5rT7yB',
    seq: 1,
    final: true,
    ts: '2026-10-01T12:00:00.000Z',
    realHuman: 0.91,
    verdict: 'human',
    kind: 'human',
    confidence: 0.74,
    reasons: ['pointer_natural', 'scroll_natural'],
    engine: 'algorithmic',
    engineVersion: '1.0.0',
    server: {
      ja4: 't13d1516h2_8daaf6152771_02713d6af862',
      uaFamily: 'chrome',
      uaMajor: 141,
      platform: 'windows',
      timezoneMatch: true,
      secFetchPresent: true,
      clientHintsPresent: true,
      clientHintsMismatch: false,
      verifiedAgent: null,
    },
    signals: validSignals(),
    context: { gaClientId: '1234567890.1700000000' },
  };
}
