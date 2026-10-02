// biome-ignore-all lint/style/noNonNullAssertion: indices are in range by construction.

// Synchronous SHA-256 (FIPS 180-4). Web Crypto is async only, and a request sent from
// `pagehide` can't wait for a promise, so the AWS content hash is computed here.

// Initial hash values and round constants: the first 32 bits of the fractional parts of the
// square roots of the first 8 primes and the cube roots of the first 64 primes.
const H: number[] = [];
const K: number[] = [];
const frac = (x: number) => ((x - Math.floor(x)) * 2 ** 32) | 0;
for (let n = 2; K.length < 64; n++) {
  let prime = true;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) prime = false;
  if (!prime) continue;
  if (H.length < 8) H.push(frac(Math.sqrt(n)));
  K.push(frac(Math.cbrt(n)));
}

const ror = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** Lowercase hex SHA-256 of the UTF-8 encoding of `text`. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const length = bytes.length;
  const blocks = (length + 72) >> 6;
  const words = new Uint32Array(blocks * 16);
  for (let i = 0; i < length; i++) words[i >> 2]! |= bytes[i]! << (24 - (i & 3) * 8);
  words[length >> 2]! |= 0x80 << (24 - (length & 3) * 8);
  words[blocks * 16 - 2] = (length / 2 ** 29) >>> 0;
  words[blocks * 16 - 1] = length << 3;

  const hash = H.slice();
  const w = new Uint32Array(64);
  for (let j = 0; j < words.length; j += 16) {
    let [a, b, c, d, e, f, g, h] = hash as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      if (i < 16) w[i] = words[j + i]!;
      else {
        const x = w[i - 15]!;
        const y = w[i - 2]!;
        w[i] =
          (ror(x, 7) ^ ror(x, 18) ^ (x >>> 3)) +
          (ror(y, 17) ^ ror(y, 19) ^ (y >>> 10)) +
          w[i - 7]! +
          w[i - 16]!;
      }
      const t1 = h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!;
      const t2 = (ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    for (const [i, v] of [a, b, c, d, e, f, g, h].entries()) hash[i] = (hash[i]! + v) | 0;
  }
  return hash.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}
