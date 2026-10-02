import { base64Decode, hmacKey } from './crypto.js';
import type { ResolvedOptions } from './options.js';

export const MIN_SECRET_BYTES = 32;

export interface SigningKeys {
  /** Signs new nonces. */
  readonly current: CryptoKey;
  /** Every key accepted when verifying, current first. */
  readonly verify: readonly CryptoKey[];
}

export type SecretProblem = 'missing' | 'too_short';

/**
 * Loads the signing secret(s) named by `secretEnv` / `previousSecretEnv`.
 * Secrets are base64; anything that isn't valid base64 is used as raw UTF-8 bytes.
 */
export async function loadKeys(
  options: ResolvedOptions,
): Promise<{ keys: SigningKeys } | { problem: SecretProblem }> {
  const current = options.env(options.secretEnv);
  if (!current) return { problem: 'missing' };
  const currentBytes = secretBytes(current);
  if (currentBytes.length < MIN_SECRET_BYTES) return { problem: 'too_short' };

  const currentKey = await hmacKey(currentBytes, `c:${current}`);
  const verify = [currentKey];

  const previous = options.env(options.previousSecretEnv);
  if (previous) {
    const previousBytes = secretBytes(previous);
    if (previousBytes.length >= MIN_SECRET_BYTES) {
      verify.push(await hmacKey(previousBytes, `p:${previous}`));
    } else {
      options.logger.warn(
        `[realhuman] ${options.previousSecretEnv} is shorter than ${MIN_SECRET_BYTES} bytes and was ignored.`,
      );
    }
  }
  return { keys: { current: currentKey, verify } };
}

function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
  const trimmed = secret.trim();
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
    const decoded = base64Decode(trimmed);
    if (decoded && decoded.length >= MIN_SECRET_BYTES) return decoded;
  }
  return new TextEncoder().encode(trimmed);
}
