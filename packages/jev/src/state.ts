import type { Analysis } from '@realhuman/engine';

/**
 * Builds the `state` sent to Jev: a compact, structured summary of one page load.
 *
 * Privacy: only derived facts are sent. Never IP addresses, the raw user agent, the raw JA4
 * string or its hashes, the browser's time zone name, `context` join keys or session ids. Fields
 * are picked explicitly, so new fields added to the analysis are not sent until listed here.
 */
export function buildState(analysis: Analysis): object {
  const { server, ja4, signals } = analysis;

  let browser: object | null = null;
  if (signals) {
    // The IANA time zone name is left out; `network.timezoneMatch` already says whether it agrees.
    const { timezone: _timezone, ...env } = signals.env;
    browser = {
      env,
      pointer: signals.pointer,
      keyboard: signals.keyboard,
      touch: signals.touch,
      scroll: signals.scroll,
      timing: signals.timing,
      honeypot: signals.honeypot,
    };
  }

  return {
    network: {
      uaFamily: server.uaFamily,
      uaMajor: server.uaMajor,
      platform: server.platform,
      timezoneMatch: server.timezoneMatch,
      secFetchPresent: server.secFetchPresent,
      clientHintsPresent: server.clientHintsPresent,
      clientHintsMismatch: server.clientHintsMismatch,
      verifiedAgent: server.verifiedAgent,
    },
    tls: {
      ja4: ja4
        ? {
            transport: ja4.transport,
            tlsVersion: ja4.tlsVersion,
            sni: ja4.sni,
            cipherCount: ja4.cipherCount,
            extensionCount: ja4.extensionCount,
            alpn: ja4.alpn,
          }
        : null,
      assessment: analysis.ja4Assessment,
    },
    browser,
    privacyBrowser: analysis.privacyBrowser,
    evidence: analysis.evidence.map((e) => ({ code: e.code, weight: e.weight })),
    neutral: [...analysis.neutral],
  };
}
