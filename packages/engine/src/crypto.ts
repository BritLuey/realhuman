// Web Crypto helpers. Only standard APIs, so the engine runs on Node.js,
// Vercel (Node and Edge), AWS Lambda, Cloudflare, Deno and Bun.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(input: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(input);
}

export function fromUtf8(input: Uint8Array): string {
  return decoder.decode(input);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes standard or URL-safe base64. Returns null for invalid input instead of throwing. */
export function base64Decode(input: string): Uint8Array<ArrayBuffer> | null {
  try {
    const normalised = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Random URL-safe id with `bytes * 8` bits of entropy. */
export function randomId(bytes = 15): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer);
}

export async function sha256(input: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const data = typeof input === 'string' ? utf8(input) : input;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/** First `length` bytes of SHA-256, base64url encoded. Used for compact, non-reversible bindings. */
export async function shortHash(input: string, length = 8): Promise<string> {
  return base64UrlEncode((await sha256(input)).slice(0, length));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

export function hmacKey(
  secretBytes: Uint8Array<ArrayBuffer>,
  cacheKey: string,
): Promise<CryptoKey> {
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
    keyCache.set(cacheKey, key);
  }
  return key;
}

export async function hmacSign(key: CryptoKey, data: string): Promise<string> {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(data))));
}

export async function hmacVerify(
  key: CryptoKey,
  data: string,
  signature: string,
): Promise<boolean> {
  const bytes = base64Decode(signature);
  if (!bytes) return false;
  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify('HMAC', key, bytes, utf8(data));
}
