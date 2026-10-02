/**
 * JA4 TLS client fingerprint helpers.
 *
 * Format: `t13d1516h2_8daaf6152771_02713d6af862`
 *          │││ │ │ │  └ hash of sorted ciphers  └ hash of sorted extensions + signature algorithms
 *          │││ │ │ └ first/last character of the first ALPN value ("00" when none)
 *          │││ │ └ number of extensions
 *          │││ └ number of cipher suites
 *          ││└ "d" = SNI to a domain, "i" = no SNI / IP
 *          │└ TLS version ("13" = TLS 1.3)
 *          └ transport: "t" TCP, "q" QUIC, "d" DTLS
 *
 * JA4 (TLS client) is BSD 3-Clause licensed by FoxIO. Only CDN-computed values are consumed here.
 */

export interface Ja4Parts {
  readonly raw: string;
  readonly transport: 't' | 'q' | 'd';
  readonly tlsVersion: number;
  readonly sni: boolean;
  readonly cipherCount: number;
  readonly extensionCount: number;
  readonly alpn: string;
  readonly cipherHash: string;
  readonly extensionHash: string;
}

const JA4_PATTERN =
  /^([tqd])(\d{2}|s3|00)([di])(\d{2})(\d{2})([0-9a-z]{2})_([0-9a-f]{12})_([0-9a-f]{12})$/i;

export function parseJa4(value: string | null): Ja4Parts | null {
  if (!value) return null;
  const raw = value.trim();
  const match = raw.match(JA4_PATTERN);
  if (!match) return null;
  const [, transport, version, sni, ciphers, extensions, alpn, cipherHash, extensionHash] = match;
  return {
    raw,
    transport: transport?.toLowerCase() as 't' | 'q' | 'd',
    tlsVersion: /^\d+$/.test(version ?? '') ? Number(version) : 0,
    sni: sni?.toLowerCase() === 'd',
    cipherCount: Number(ciphers),
    extensionCount: Number(extensions),
    alpn: (alpn ?? '').toLowerCase(),
    cipherHash: (cipherHash ?? '').toLowerCase(),
    extensionHash: (extensionHash ?? '').toLowerCase(),
  };
}

export interface Ja4Lists {
  /** Exact JA4 values known to come from real browsers. Never flagged. */
  readonly browser: readonly string[];
  /** Exact JA4 values known to come from non-browser clients. Always gated. */
  readonly nonBrowser: readonly string[];
}

export type Ja4Assessment =
  | 'browser_like'
  | 'mismatch'
  | 'non_browser'
  | 'known_non_browser'
  | 'unknown';

/**
 * Compares a JA4 fingerprint with a client that claims to be a modern browser.
 *
 * - `known_non_browser`: an exact match in your own non-browser list.
 * - `non_browser`: no ALPN at all, as HTTP libraries connect. No modern browser does this, but a
 *   company proxy that re-encrypts traffic can, so it's weighted evidence, not a gate.
 * - `mismatch`: unusual for a browser (TLS < 1.3, no SNI, HTTP/1.1-only ALPN, very few ciphers or
 *   extensions). Real people behind unusual proxies can trigger this too.
 */
export function assessJa4(
  parts: Ja4Parts | null,
  claimsBrowser: boolean,
  lists: Ja4Lists,
): Ja4Assessment {
  if (!parts) return 'unknown';
  const raw = parts.raw.toLowerCase();
  if (lists.browser.some((value) => value.toLowerCase() === raw)) return 'browser_like';
  if (lists.nonBrowser.some((value) => value.toLowerCase() === raw)) return 'known_non_browser';
  if (!claimsBrowser) return 'unknown';
  if (parts.alpn === '00') return 'non_browser';
  if (parts.tlsVersion < 13 || !parts.sni) return 'mismatch';
  if (parts.transport === 't' && parts.alpn !== 'h2') return 'mismatch';
  if (parts.cipherCount < 3 || parts.extensionCount < 8) return 'mismatch';
  return 'browser_like';
}
