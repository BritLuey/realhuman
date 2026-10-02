import {
  base64Decode,
  base64UrlEncode,
  fromUtf8,
  hmacSign,
  hmacVerify,
  shortHash,
  utf8,
} from './crypto.js';
import type { SigningKeys } from './secrets.js';

/**
 * Session nonces: `v1.<payload>.<signature>`.
 *
 * The payload binds the nonce to its session id and to short hashes of the
 * client's user agent and JA4 TLS fingerprint, so a payload recorded from one
 * client can't be replayed from another.
 */
interface NonceClaims {
  /** session id */
  s: string;
  /** issued at, epoch ms */
  i: number;
  /** expires at, epoch ms */
  e: number;
  /** hash of the user agent */
  u: string;
  /** hash of the JA4 fingerprint, or '' if unknown */
  j: string;
  /** JA4 transport: 't' (TCP), 'q' (QUIC), 'd' (DTLS) or '' */
  p: string;
}

export interface ClientBinding {
  readonly userAgent: string | null;
  readonly ja4: string | null;
}

export interface VerifiedNonce {
  readonly sid: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  /** null when valid; otherwise why it failed. */
  readonly problem: null | 'nonce_invalid' | 'nonce_expired' | 'nonce_replayed';
}

async function bindingOf(binding: ClientBinding): Promise<Pick<NonceClaims, 'u' | 'j' | 'p'>> {
  return {
    u: await shortHash(`ua:${binding.userAgent ?? ''}`),
    j: binding.ja4 ? await shortHash(`ja4:${binding.ja4}`) : '',
    p: binding.ja4?.[0] ?? '',
  };
}

export async function issueNonce(
  keys: SigningKeys,
  sid: string,
  binding: ClientBinding,
  now: number,
  ttlMs: number,
): Promise<{ nonce: string; expiresAt: number }> {
  const claims: NonceClaims = { s: sid, i: now, e: now + ttlMs, ...(await bindingOf(binding)) };
  const payload = base64UrlEncode(utf8(JSON.stringify(claims)));
  const signature = await hmacSign(keys.current, `v1.${payload}`);
  return { nonce: `v1.${payload}.${signature}`, expiresAt: claims.e };
}

/**
 * Verifies a nonce. Never throws.
 *
 * @param allowExpired accept nonces up to this many ms past expiry (used for refreshes and trap links).
 */
export async function verifyNonce(
  keys: SigningKeys,
  nonce: string,
  binding: ClientBinding | null,
  now: number,
  allowExpired = 0,
): Promise<VerifiedNonce> {
  const invalid: VerifiedNonce = { sid: '', issuedAt: 0, expiresAt: 0, problem: 'nonce_invalid' };
  const parts = nonce.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) return invalid;

  let signatureOk = false;
  for (const key of keys.verify) {
    if (await hmacVerify(key, `v1.${parts[1]}`, parts[2])) {
      signatureOk = true;
      break;
    }
  }
  if (!signatureOk) return invalid;

  const claims = parseClaims(parts[1]);
  if (!claims) return invalid;

  const base = { sid: claims.s, issuedAt: claims.i, expiresAt: claims.e };
  if (now > claims.e + allowExpired) return { ...base, problem: 'nonce_expired' };

  if (binding) {
    const actual = await bindingOf(binding);
    if (actual.u !== claims.u) return { ...base, problem: 'nonce_replayed' };
    // Browsers can switch between HTTP/2 (TCP) and HTTP/3 (QUIC) between requests, which changes
    // the JA4. Only compare fingerprints taken over the same transport.
    if (claims.j && actual.j && claims.p === actual.p && claims.j !== actual.j) {
      return { ...base, problem: 'nonce_replayed' };
    }
  }
  return { ...base, problem: null };
}

function parseClaims(encoded: string): NonceClaims | null {
  const bytes = base64Decode(encoded);
  if (!bytes) return null;
  try {
    const value = JSON.parse(fromUtf8(bytes)) as Partial<NonceClaims>;
    if (
      typeof value.s === 'string' &&
      typeof value.i === 'number' &&
      typeof value.e === 'number' &&
      typeof value.u === 'string' &&
      typeof value.j === 'string' &&
      typeof value.p === 'string'
    ) {
      return value as NonceClaims;
    }
  } catch {}
  return null;
}
