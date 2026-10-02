import { base64Decode, base64UrlEncode, sha256, utf8 } from './crypto.js';
import type { ResolvedOptions } from './options.js';

/**
 * Web Bot Auth: AI agents and crawlers sign requests with HTTP Message Signatures (RFC 9421)
 * using Ed25519 keys published at `<agent origin>/.well-known/http-message-signatures-directory`.
 *
 * Only agents listed in `webBotAuth.agents` are ever fetched, so a request can't make the server
 * call arbitrary URLs.
 */

const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';
const DIRECTORY_TTL_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 1500;
const MAX_DIRECTORY_BYTES = 64 * 1024;
const CLOCK_SKEW_S = 60;

interface Jwk {
  kty?: string;
  crv?: string;
  x?: string;
}

interface SignatureInput {
  readonly label: string;
  readonly components: readonly string[];
  readonly params: Readonly<Record<string, string | number>>;
  /** The serialized inner list and parameters, exactly as received. */
  readonly serialized: string;
}

const directoryCache = new Map<string, { expires: number; keys: Promise<Jwk[]> }>();

/** For tests. */
export function clearDirectoryCache(): void {
  directoryCache.clear();
}

/** Returns the verified agent's host name, or null. Never throws. */
export async function verifyWebBotAuth(
  request: Request,
  options: ResolvedOptions,
): Promise<string | null> {
  try {
    const { agents } = options.webBotAuth;
    if (agents.length === 0) return null;
    const signatureInput = request.headers.get('signature-input');
    const signature = request.headers.get('signature');
    const signatureAgent = request.headers.get('signature-agent');
    if (!signatureInput || !signature || !signatureAgent) return null;

    const agentOrigin = parseAgentOrigin(signatureAgent);
    if (!agentOrigin) return null;
    const allowed = agents.some((agent) => normaliseOrigin(agent) === agentOrigin);
    if (!allowed) return null;

    const input = parseSignatureInput(signatureInput).find(
      (entry) => entry.params.tag === 'web-bot-auth',
    );
    if (!input) return null;
    if (!input.components.includes('@authority')) return null;

    const now = Math.floor(options.now() / 1000);
    const created = input.params.created;
    const expires = input.params.expires;
    if (typeof created !== 'number' || created > now + CLOCK_SKEW_S) return null;
    if (typeof expires !== 'number' || expires < now - CLOCK_SKEW_S) return null;
    if (input.params.alg !== undefined && input.params.alg !== 'ed25519') return null;
    const keyId = input.params.keyid;
    if (typeof keyId !== 'string') return null;

    const signatureBytes = parseSignature(signature, input.label);
    if (!signatureBytes) return null;

    const authority = options.webBotAuth.authority ?? new URL(request.url).host;
    const base = signatureBase(input, request, authority);
    if (base === null) return null;

    const keys = await loadDirectory(agentOrigin, options);
    for (const jwk of keys) {
      if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) continue;
      if ((await jwkThumbprint(jwk)) !== keyId) continue;
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
        { name: 'Ed25519' },
        false,
        ['verify'],
      );
      if (await crypto.subtle.verify({ name: 'Ed25519' }, key, signatureBytes, utf8(base))) {
        return new URL(agentOrigin).host;
      }
    }
    return null;
  } catch (error) {
    if (options.debug) options.logger.debug('[realhuman] Web Bot Auth verification failed', error);
    return null;
  }
}

function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Accepts `"https://agent.example"` or a dictionary like `agent1="https://agent.example"`. */
export function parseAgentOrigin(header: string): string | null {
  const match = header.match(/"(https:\/\/[^"]+)"/) ?? header.match(/(https:\/\/[^\s,;]+)/);
  return match?.[1] ? normaliseOrigin(match[1]) : null;
}

/** Minimal RFC 8941 parser for the Signature-Input dictionary. */
export function parseSignatureInput(header: string): SignatureInput[] {
  const entries: SignatureInput[] = [];
  for (const match of header.matchAll(
    /([a-z*][a-z0-9_\-.*]*)=(\([^)]*\)((?:;[^,;=]+=(?:"[^"]*"|[^,;]+))*))/gi,
  )) {
    const label = match[1] ?? '';
    const serialized = match[2] ?? '';
    const listPart = serialized.slice(0, serialized.indexOf(')') + 1);
    const components = [...listPart.matchAll(/"([^"]+)"/g)].map((m) => (m[1] ?? '').toLowerCase());
    const params: Record<string, string | number> = {};
    for (const param of (match[3] ?? '').matchAll(/;([^=;]+)=("([^"]*)"|[^;]+)/g)) {
      const key = (param[1] ?? '').trim();
      if (param[3] !== undefined) params[key] = param[3];
      else {
        const numeric = Number(param[2]);
        params[key] = Number.isFinite(numeric) ? numeric : (param[2] ?? '');
      }
    }
    entries.push({ label, components, params, serialized });
  }
  return entries;
}

function parseSignature(header: string, label: string): Uint8Array<ArrayBuffer> | null {
  for (const match of header.matchAll(/([a-z*][a-z0-9_\-.*]*)=:([A-Za-z0-9+/=]+):/gi)) {
    if (match[1] === label && match[2]) return base64Decode(match[2]);
  }
  return null;
}

function signatureBase(input: SignatureInput, request: Request, authority: string): string | null {
  const lines: string[] = [];
  for (const component of input.components) {
    let value: string | null;
    if (component === '@authority') value = authority.toLowerCase();
    else if (component === '@method') value = request.method.toUpperCase();
    else if (component === '@path') value = new URL(request.url).pathname;
    else if (component.startsWith('@')) return null;
    else value = request.headers.get(component)?.trim() ?? null;
    if (value === null) return null;
    lines.push(`"${component}": ${value}`);
  }
  lines.push(`"@signature-params": ${input.serialized}`);
  return lines.join('\n');
}

/** RFC 7638 JWK thumbprint for an OKP key. */
async function jwkThumbprint(jwk: Jwk): Promise<string> {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  return base64UrlEncode(await sha256(canonical));
}

function loadDirectory(origin: string, options: ResolvedOptions): Promise<Jwk[]> {
  const cached = directoryCache.get(origin);
  const now = options.now();
  if (cached && cached.expires > now) return cached.keys;

  const keys = fetchDirectory(origin, options).catch((error) => {
    directoryCache.delete(origin);
    if (options.debug)
      options.logger.debug(`[realhuman] Could not load key directory for ${origin}`, error);
    return [] as Jwk[];
  });
  directoryCache.set(origin, { expires: now + DIRECTORY_TTL_MS, keys });
  return keys;
}

async function fetchDirectory(origin: string, options: ResolvedOptions): Promise<Jwk[]> {
  const doFetch = options.webBotAuth.fetch ?? fetch;
  const response = await doFetch(`${origin}${DIRECTORY_PATH}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/http-message-signatures-directory+json, application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_DIRECTORY_BYTES) throw new Error('directory too large');
  const body = JSON.parse(text) as { keys?: unknown };
  return Array.isArray(body.keys) ? (body.keys as Jwk[]) : [];
}
