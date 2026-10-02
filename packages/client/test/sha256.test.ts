import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/sha256.js';

const reference = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it('matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches node:crypto across block boundaries and multi-byte text', () => {
    for (let length = 0; length <= 200; length++) {
      const text = 'a'.repeat(length);
      expect(sha256Hex(text), `length ${length}`).toBe(reference(text));
    }
    for (const text of [
      'héllo wörld',
      '日本語テキスト',
      '🙂🙃 emoji',
      JSON.stringify({ a: [1, 2] }),
    ]) {
      expect(sha256Hex(text)).toBe(reference(text));
    }
  });

  it('handles a realistic payload size', () => {
    const text = JSON.stringify({ data: 'x'.repeat(5000), n: Math.PI });
    expect(sha256Hex(text)).toBe(reference(text));
  });
});
