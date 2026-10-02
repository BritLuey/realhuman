import type { Payload } from '@realhuman/engine';
import type { LambdaFunctionURLEvent } from 'aws-lambda';

export const SECRET = Buffer.alloc(32, 7).toString('base64');
export const OTHER_SECRET = Buffer.alloc(32, 9).toString('base64');
export const CHROME_JA4 = 't13d1516h2_8daaf6152771_02713d6af862';
export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** Headers as CloudFront forwards them to the function URL (lower-case, as Lambda delivers them). */
export function cloudFrontHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    host: 'abc123.lambda-url.eu-west-1.on.aws',
    'user-agent': CHROME_UA,
    'sec-ch-ua': '"Chromium";v="141", "Not?A_Brand";v="8", "Google Chrome";v="141"',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'cloudfront-viewer-ja4-fingerprint': CHROME_JA4,
    'cloudfront-viewer-time-zone': 'Europe/London',
    'x-amzn-trace-id': 'Root=1-00000000-000000000000000000000000',
    ...overrides,
  };
}

/** A complete function URL event, typed with `@types/aws-lambda` to prove compatibility. */
export function urlEvent(
  method: string,
  path: string,
  init: { query?: string; headers?: Record<string, string>; body?: string; base64?: boolean } = {},
): LambdaFunctionURLEvent {
  const headers = init.headers ?? cloudFrontHeaders();
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: init.query ?? '',
    headers,
    requestContext: {
      accountId: 'anonymous',
      apiId: 'abc123',
      domainName: 'abc123.lambda-url.eu-west-1.on.aws',
      domainPrefix: 'abc123',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '130.176.0.1',
        userAgent: headers['user-agent'] ?? '',
      },
      requestId: 'req-1',
      routeKey: '$default',
      stage: '$default',
      time: '01/Oct/2026:12:00:00 +0000',
      timeEpoch: 1_790_000_000_000,
    },
    ...(init.body !== undefined && { body: init.body }),
    isBase64Encoded: init.base64 ?? false,
  };
}

export function payload(sid: string, nonce: string): Payload {
  return {
    v: 1,
    sid,
    seq: 0,
    final: false,
    nonce,
    elapsedMs: 1003.4,
    wallElapsedMs: 1003,
    nonceAgeMs: 5,
    context: { gaClientId: '1234567890.1700000000' },
    signals: {
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
    },
  };
}

export interface InitBody {
  sid: string;
  nonce: string;
  expiresAt: number;
}
