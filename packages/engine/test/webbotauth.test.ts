import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOptions } from '../src/index.js';
import { clearDirectoryCache, parseSignatureInput, verifyWebBotAuth } from '../src/webbotauth.js';
import { silentLogger } from './helpers.js';

const AGENT = 'https://agent.example';
const NOW = 1_790_000_000_000;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString(
    'base64url',
  );
}

async function setup() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const thumbprint = b64url(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`),
    ),
  );
  const fetchDirectory = vi.fn(async () => Response.json({ keys: [jwk] }));
  return { pair, thumbprint, fetchDirectory };
}

async function signedRequest(
  pair: CryptoKeyPair,
  keyid: string,
  opts: { created?: number; expires?: number; authority?: string } = {},
): Promise<Request> {
  const created = opts.created ?? Math.floor(NOW / 1000) - 5;
  const expires = opts.expires ?? created + 60;
  const params = `("@authority" "signature-agent");created=${created};expires=${expires};keyid="${keyid}";alg="ed25519";nonce="abc";tag="web-bot-auth"`;
  const agentHeader = `"${AGENT}"`;
  const base = [
    `"@authority": ${opts.authority ?? 'shop.example'}`,
    `"signature-agent": ${agentHeader}`,
    `"@signature-params": ${params}`,
  ].join('\n');
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(base)),
  );
  return new Request('https://shop.example/api/realhuman/score', {
    method: 'POST',
    headers: {
      'signature-agent': agentHeader,
      'signature-input': `sig1=${params}`,
      signature: `sig1=:${Buffer.from(signature).toString('base64')}:`,
    },
  });
}

describe('Web Bot Auth', () => {
  beforeEach(() => clearDirectoryCache());

  it('parses Signature-Input', () => {
    const [entry] = parseSignatureInput(
      'sig1=("@authority" "signature-agent");created=1;expires=2;keyid="k";tag="web-bot-auth"',
    );
    expect(entry).toMatchObject({
      label: 'sig1',
      components: ['@authority', 'signature-agent'],
      params: { created: 1, expires: 2, keyid: 'k', tag: 'web-bot-auth' },
    });
  });

  it('verifies a valid signature from an allowed agent', async () => {
    const { pair, thumbprint, fetchDirectory } = await setup();
    const options = resolveOptions({
      webBotAuth: { agents: [AGENT], fetch: fetchDirectory as unknown as typeof fetch },
      now: () => NOW,
      logger: silentLogger,
      onDecision: () => {},
    });
    expect(await verifyWebBotAuth(await signedRequest(pair, thumbprint), options)).toBe(
      'agent.example',
    );
    expect(fetchDirectory).toHaveBeenCalledWith(
      'https://agent.example/.well-known/http-message-signatures-directory',
      expect.objectContaining({ redirect: 'error' }),
    );
    // The directory is cached.
    await verifyWebBotAuth(await signedRequest(pair, thumbprint), options);
    expect(fetchDirectory).toHaveBeenCalledTimes(1);
  });

  it('never fetches directories of agents that are not allowed', async () => {
    const { pair, thumbprint, fetchDirectory } = await setup();
    const options = resolveOptions({
      webBotAuth: {
        agents: ['https://other.example'],
        fetch: fetchDirectory as unknown as typeof fetch,
      },
      now: () => NOW,
      logger: silentLogger,
      onDecision: () => {},
    });
    expect(await verifyWebBotAuth(await signedRequest(pair, thumbprint), options)).toBeNull();
    expect(fetchDirectory).not.toHaveBeenCalled();
  });

  it('rejects expired signatures, wrong authorities and unknown keys', async () => {
    const { pair, thumbprint, fetchDirectory } = await setup();
    const options = resolveOptions({
      webBotAuth: { agents: [AGENT], fetch: fetchDirectory as unknown as typeof fetch },
      now: () => NOW,
      logger: silentLogger,
      onDecision: () => {},
    });
    const old = Math.floor(NOW / 1000) - 3600;
    expect(
      await verifyWebBotAuth(
        await signedRequest(pair, thumbprint, { created: old, expires: old + 60 }),
        options,
      ),
    ).toBeNull();
    expect(
      await verifyWebBotAuth(
        await signedRequest(pair, thumbprint, { authority: 'evil.example' }),
        options,
      ),
    ).toBeNull();
    expect(await verifyWebBotAuth(await signedRequest(pair, 'not-the-key'), options)).toBeNull();
  });

  it('uses the configured authority behind a CDN', async () => {
    const { pair, thumbprint, fetchDirectory } = await setup();
    const options = resolveOptions({
      webBotAuth: {
        agents: [AGENT],
        authority: 'www.shop.example',
        fetch: fetchDirectory as unknown as typeof fetch,
      },
      now: () => NOW,
      logger: silentLogger,
      onDecision: () => {},
    });
    const request = await signedRequest(pair, thumbprint, { authority: 'www.shop.example' });
    expect(await verifyWebBotAuth(request, options)).toBe('agent.example');
  });
});
