import {
  createRealHuman,
  defaultEnv,
  type EngineOptions,
  type EnvReader,
  type TrustedFacts,
} from '@realhuman/engine';

export type { TrustedFacts } from '@realhuman/engine';
export { VERSION } from './version.js';

/**
 * The parts of a Lambda function URL event (payload format 2.0) the handler reads. Structurally
 * compatible with `LambdaFunctionURLEvent` from `@types/aws-lambda`, which you don't need to install.
 */
export interface LambdaFunctionURLEvent {
  readonly rawPath: string;
  readonly rawQueryString?: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
  readonly requestContext: { readonly http: { readonly method: string } };
}

/** A structured function URL response. Compatible with `LambdaFunctionURLResult` from `@types/aws-lambda`. */
export interface LambdaFunctionURLResult {
  statusCode: number;
  headers?: Record<string, string>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
}

export interface LambdaHandlerOptions extends EngineOptions {
  /**
   * **Name** of the environment variable holding a Secrets Manager secret ARN. When that variable is
   * set, the signing secret is loaded from Secrets Manager on the first invocation and cached for the
   * life of the container; `secretEnv` and `previousSecretEnv` are then not read from the environment.
   * Default `'REALHUMAN_SECRET_ARN'`.
   */
  readonly secretArnEnv?: string;
}

export type LambdaHandler = (event: LambdaFunctionURLEvent) => Promise<LambdaFunctionURLResult>;

interface LoadedSecret {
  readonly current: string;
  readonly previous: string | undefined;
}

/** After a failed Secrets Manager call, wait this long before trying again. */
const SECRET_RETRY_MS = 60_000;

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

/**
 * Creates the Lambda handler for a function URL behind CloudFront. Export the result as `handler`.
 * Never throws: unexpected errors are logged and answered with 204.
 */
export function createLambdaHandler(options: LambdaHandlerOptions = {}): LambdaHandler {
  const { secretArnEnv = 'REALHUMAN_SECRET_ARN', ...engineOptions } = options;
  const baseEnv = options.env ?? defaultEnv;
  const logger = options.logger ?? console;
  const now = options.now ?? Date.now;
  const secretEnv = options.secretEnv ?? 'REALHUMAN_SECRET';
  const previousSecretEnv = options.previousSecretEnv ?? 'REALHUMAN_SECRET_PREVIOUS';
  const secretArn = baseEnv(secretArnEnv);

  let secret: LoadedSecret | null = null;
  let loading: Promise<LoadedSecret> | null = null;
  let retryAt = 0;

  // The engine reads the secret through `env` on every request, so it picks up the value from
  // Secrets Manager as soon as it arrives, including after a failed first attempt.
  const env: EnvReader = (name) => {
    if (secretArn) {
      if (name === secretEnv) return secret?.current;
      if (name === previousSecretEnv) return secret?.previous;
    }
    return baseEnv(name);
  };
  const engine = createRealHuman({ ...engineOptions, env });

  async function ensureSecret(arn: string): Promise<void> {
    if (secret || now() < retryAt) return;
    loading ??= fetchSecret(arn);
    try {
      secret = await loading;
    } catch (error) {
      loading = null;
      retryAt = now() + SECRET_RETRY_MS;
      logger.error(
        `[realhuman] Could not load the secret from Secrets Manager (${arn}). Every session is reported as 'uncertain' until it loads; retrying in ${SECRET_RETRY_MS / 1000} s.`,
        error,
      );
    }
  }

  return async (event) => {
    try {
      if (secretArn) await ensureSecret(secretArn);
      const request = toRequest(event);
      // No waitUntil: Lambda freezes the container once the response is returned, so the engine
      // finishes background work (such as onDecision) before responding.
      const response = await engine.handle(request, { trusted: trustedFacts(request.headers) });
      return await toResult(response);
    } catch (error) {
      logger.error('[realhuman] Lambda handler failed', error);
      return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
    }
  };
}

/** Converts a function URL event into a Web `Request`. Cookies are ignored; realHuman uses none. */
export function toRequest(event: LambdaFunctionURLEvent): Request {
  const method = event.requestContext.http.method.toUpperCase();
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(name, value);
  }

  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost';
  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
  const url = `https://${host}${event.rawPath}${query}`;

  let body: Uint8Array<ArrayBuffer> | string | null = null;
  if (!BODYLESS_METHODS.has(method) && event.body) {
    body = event.isBase64Encoded ? base64ToBytes(event.body) : event.body;
  }
  return new Request(url, { method, headers, body });
}

/** Converts a Web `Response` into a function URL result. */
export async function toResult(response: Response): Promise<LambdaFunctionURLResult> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') headers[name] = value;
  });
  const result: LambdaFunctionURLResult = { statusCode: response.status, headers };

  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) result.cookies = cookies;

  if (response.body) {
    const text = isTextual(response.headers.get('content-type'));
    result.body = text
      ? await response.text()
      : bytesToBase64(new Uint8Array(await response.arrayBuffer()));
    result.isBase64Encoded = !text;
  }
  return result;
}

/**
 * Reads the network facts CloudFront adds when the origin request policy forwards
 * `CloudFront-Viewer-JA4-Fingerprint` and `CloudFront-Viewer-Time-Zone`.
 */
export function trustedFacts(headers: Headers): TrustedFacts {
  return {
    ja4: headers.get('cloudfront-viewer-ja4-fingerprint')?.trim() || null,
    ipTimezone: headers.get('cloudfront-viewer-time-zone')?.trim() || null,
  };
}

// Web APIs rather than Buffer, so the package type-checks without Node's types.
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function isTextual(contentType: string | null): boolean {
  if (!contentType) return true;
  return /^text\/|json|javascript|xml|x-www-form-urlencoded/i.test(contentType);
}

/**
 * Fetches the secret. `SecretString` is either the base64 secret itself or, during rotation,
 * JSON `{ "current": "…", "previous": "…" }`.
 */
async function fetchSecret(arn: string): Promise<LoadedSecret> {
  const { GetSecretValueCommand, SecretsManagerClient } = await import(
    '@aws-sdk/client-secrets-manager'
  );
  // A full ARN names its region, so a secret in another region (e.g. us-east-1) still works.
  const region = arn.startsWith('arn:') ? arn.split(':')[3] : undefined;
  const client = new SecretsManagerClient(region ? { region } : {});
  const output = await client.send(new GetSecretValueCommand({ SecretId: arn }));

  if (output.SecretString !== undefined) return parseSecret(output.SecretString);
  if (output.SecretBinary !== undefined) {
    return { current: bytesToBase64(output.SecretBinary), previous: undefined };
  }
  throw new Error('The secret has no value.');
}

function parseSecret(value: string): LoadedSecret {
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new Error('The secret looks like JSON but could not be parsed.');
    }
    const { current, previous } = (json ?? {}) as { current?: unknown; previous?: unknown };
    if (typeof current !== 'string' || current === '') {
      throw new Error(
        'A JSON secret needs a "current" string, e.g. {"current":"…","previous":"…"}.',
      );
    }
    return { current, previous: typeof previous === 'string' && previous ? previous : undefined };
  }
  if (!trimmed) throw new Error('The secret is empty.');
  return { current: trimmed, previous: undefined };
}
