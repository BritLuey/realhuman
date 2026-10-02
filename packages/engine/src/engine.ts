import {
  type ClientResult,
  type Context,
  type DecisionRecord,
  type Kind,
  parsePayload,
  type ReasonCode,
  SCHEMA_VERSION,
  type ServerFacts,
  type ShadowResult,
  type Signals,
  type Verdict,
} from '@realhuman/schema';
import { algorithmicScorer } from './algorithmic.js';
import { analyze } from './analysis.js';
import { randomId } from './crypto.js';
import { type Decision, decideWith, toShadow } from './decide.js';
import { deriveServerFacts, type TrustedFacts } from './facts.js';
import { type ClientBinding, issueNonce, verifyNonce } from './nonce.js';
import { type EngineOptions, type ResolvedOptions, resolveOptions } from './options.js';
import { loadKeys, MIN_SECRET_BYTES, type SigningKeys } from './secrets.js';
import { parseUserAgent } from './ua.js';
import { VERSION } from './version.js';
import { verifyWebBotAuth } from './webbotauth.js';

export interface HandleContext {
  /** Network facts read from headers your CDN or proxy sets. */
  readonly trusted: TrustedFacts;
  /**
   * Keeps background work alive after the response is sent (Vercel `waitUntil`, Cloudflare
   * `ctx.waitUntil`). Without it, background work finishes before the response is returned,
   * which is what AWS Lambda needs.
   */
  readonly waitUntil?: (promise: Promise<unknown>) => void;
}

/** Network-only label for a single request. See `RealHuman.tag`. */
export interface EdgeTag {
  readonly ts: string;
  readonly path: string;
  readonly realHuman: number;
  readonly verdict: Verdict;
  readonly kind: Kind;
  readonly reasons: readonly ReasonCode[];
  readonly server: ServerFacts;
}

export interface RealHuman {
  readonly options: ResolvedOptions;
  /** Handles `GET …/init`, `POST …/score`, `GET …/t` and CORS preflights. Never throws. */
  handle(request: Request, ctx: HandleContext): Promise<Response>;
  /** Labels any request from network evidence alone. Never blocks, never throws. */
  tag(request: Request, trusted: TrustedFacts): Promise<EdgeTag>;
}

/** How much later than the server's clock a client may claim its nonce arrived. */
const CLOCK_TOLERANCE_MS = 3000;
/** How long an expired nonce can still be refreshed or used by a trap link. */
const GRACE_MS = 24 * 60 * 60_000;
/** Trap-link decisions use this seq so they supersede every regular update. */
const TRAP_SEQ = 1000;

export function createRealHuman(input: EngineOptions = {}): RealHuman {
  const options = resolveOptions(input);
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    options.logger.error(message);
  };

  if (options.deliver !== 'client' && !options.onDecision) {
    options.logger.warn(
      `[realhuman] deliver is '${options.deliver}' but no onDecision callback was given, so decisions are discarded.`,
    );
  }

  async function keys(): Promise<SigningKeys | null> {
    const result = await loadKeys(options);
    if ('keys' in result) return result.keys;
    warnOnce(
      `secret:${result.problem}`,
      result.problem === 'missing'
        ? `[realhuman] The environment variable ${options.secretEnv} is not set. Every session is reported as 'uncertain' until it is.`
        : `[realhuman] ${options.secretEnv} must contain at least ${MIN_SECRET_BYTES} random bytes. Every session is reported as 'uncertain' until it does.`,
    );
    return null;
  }

  function background(ctx: HandleContext, task: () => Promise<void>): Promise<void> {
    const run = task().catch((error) =>
      options.logger.error('[realhuman] background task failed', error),
    );
    if (ctx.waitUntil) {
      ctx.waitUntil(run);
      return Promise.resolve();
    }
    return run;
  }

  async function emit(record: DecisionRecord): Promise<void> {
    if (options.debug) {
      options.logger.debug(
        `[realhuman] ${record.sid}#${record.seq} ${record.verdict} ${record.realHuman} (${record.engine}) ${record.reasons.join(',')}`,
      );
    }
    const onDecision = options.onDecision;
    if (!onDecision) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => onDecision(record)),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`onDecision exceeded ${options.onDecisionTimeoutMs} ms`)),
            options.onDecisionTimeoutMs,
          );
        }),
      ]);
    } catch (error) {
      options.logger.error('[realhuman] onDecision failed', error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function buildRecord(args: {
    sid: string;
    seq: number;
    final: boolean;
    decision: Decision;
    shadow?: ShadowResult;
    server: ServerFacts;
    signals: Signals | null;
    context: Context;
  }): DecisionRecord {
    const { decision } = args;
    return {
      v: SCHEMA_VERSION,
      sid: args.sid,
      seq: args.seq,
      final: args.final,
      ts: new Date(options.now()).toISOString(),
      realHuman: decision.realHuman,
      verdict: decision.verdict,
      kind: decision.kind,
      confidence: decision.confidence,
      reasons: decision.reasons,
      engine: decision.engine,
      engineVersion: VERSION,
      ...(decision.model !== undefined && { model: decision.model }),
      ...(decision.provider !== undefined && { provider: decision.provider }),
      ...(decision.questionsVersion !== undefined && {
        questionsVersion: decision.questionsVersion,
      }),
      ...(args.shadow !== undefined && { shadow: args.shadow }),
      server: args.server,
      signals: args.signals,
      context: args.context,
    };
  }

  function clientResult(
    sid: string,
    seq: number,
    decision: Pick<Decision, 'realHuman' | 'verdict' | 'kind' | 'confidence'>,
  ): ClientResult {
    const result: { -readonly [K in keyof ClientResult]: ClientResult[K] } = {
      v: SCHEMA_VERSION,
      sid,
      seq,
    };
    for (const field of options.clientFields) {
      if (field === 'realHuman') result.realHuman = decision.realHuman;
      if (field === 'verdict') result.verdict = decision.verdict;
      if (field === 'kind') result.kind = decision.kind;
      if (field === 'confidence') result.confidence = decision.confidence;
    }
    return result;
  }

  function corsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get('origin');
    if (!origin || !options.allowedOrigins.includes(origin)) return {};
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-amz-content-sha256',
      'access-control-max-age': '600',
      vary: 'Origin',
    };
  }

  function respond(status: number, body: unknown, cors: Record<string, string>): Response {
    const headers: Record<string, string> = { 'cache-control': 'no-store', ...cors };
    if (body === null) return new Response(null, { status, headers });
    headers['content-type'] = 'application/json; charset=utf-8';
    return new Response(JSON.stringify(body), { status, headers });
  }

  function bindingOf(request: Request, trusted: TrustedFacts): ClientBinding {
    return { userAgent: request.headers.get('user-agent'), ja4: trusted.ja4?.trim() || null };
  }

  // ── GET …/init ─────────────────────────────────────────────────────────────
  async function handleInit(
    request: Request,
    url: URL,
    ctx: HandleContext,
    cors: Record<string, string>,
  ) {
    const now = options.now();
    const signing = await keys();
    if (!signing) {
      return respond(
        200,
        {
          v: SCHEMA_VERSION,
          sid: randomId(),
          nonce: `unconfigured.${randomId()}`,
          expiresAt: now + options.nonceTtlMs,
        },
        cors,
      );
    }
    const binding = bindingOf(request, ctx.trusted);
    let sid = randomId();
    const refresh = url.searchParams.get('refresh');
    if (refresh) {
      const previous = await verifyNonce(signing, refresh, binding, now, GRACE_MS);
      if (previous.problem === null) sid = previous.sid;
    }
    const { nonce, expiresAt } = await issueNonce(signing, sid, binding, now, options.nonceTtlMs);
    return respond(200, { v: SCHEMA_VERSION, sid, nonce, expiresAt }, cors);
  }

  // ── POST …/score ───────────────────────────────────────────────────────────
  async function handleScore(request: Request, ctx: HandleContext, cors: Record<string, string>) {
    const body = await readBody(request, options.maxPayloadBytes);
    if (body === 'too_large') return respond(413, { error: 'payload_too_large' }, cors);

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return respond(400, { error: 'invalid_payload' }, cors);
    }
    const parsed = parsePayload(json);
    if (!parsed.success) {
      if (options.debug) options.logger.debug('[realhuman] invalid payload', parsed.issues);
      return respond(400, { error: 'invalid_payload' }, cors);
    }
    const payload = parsed.output;

    const signing = await keys();
    if (!signing) {
      return options.deliver === 'server'
        ? respond(204, null, cors)
        : respond(
            200,
            clientResult(payload.sid, payload.seq, {
              realHuman: 0.5,
              verdict: 'uncertain',
              kind: 'unknown',
              confidence: 0,
            }),
            cors,
          );
    }

    const now = options.now();
    const gates: ReasonCode[] = [];
    const nonce = await verifyNonce(signing, payload.nonce, bindingOf(request, ctx.trusted), now);
    if (nonce.problem) gates.push(nonce.problem);
    else if (nonce.sid !== payload.sid) gates.push('nonce_invalid');
    else if (payload.nonceAgeMs > now - nonce.issuedAt + CLOCK_TOLERANCE_MS) gates.push('too_fast');

    const verifiedAgent = await verifyWebBotAuth(request, options);
    const server = deriveServerFacts(
      request.headers,
      ctx.trusted,
      payload.signals.env.timezone,
      verifiedAgent,
    );
    const analysis = analyze({
      signals: payload.signals,
      server,
      gates,
      ja4Lists: options.ja4,
      uaHeadless: parseUserAgent(request.headers.get('user-agent')).headless,
    });

    const record = async (decision: Decision): Promise<DecisionRecord> => {
      const shadow = options.shadow
        ? toShadow(await decideWith(options.shadow, analysis, options))
        : undefined;
      return buildRecord({
        sid: payload.sid,
        seq: payload.seq,
        final: payload.final,
        decision,
        ...(shadow !== undefined && { shadow }),
        server,
        signals: payload.signals,
        context: payload.context,
      });
    };

    if (options.deliver === 'server') {
      await background(ctx, async () =>
        emit(await record(await decideWith(options.engine, analysis, options))),
      );
      return respond(204, null, cors);
    }

    const decision = await decideWith(options.engine, analysis, options);
    if (options.deliver === 'both') {
      await background(ctx, async () => emit(await record(decision)));
    }
    return respond(200, clientResult(payload.sid, payload.seq, decision), cors);
  }

  // ── GET …/t (trap link) ────────────────────────────────────────────────────
  async function handleTrap(
    request: Request,
    url: URL,
    ctx: HandleContext,
    cors: Record<string, string>,
  ) {
    const sid = url.searchParams.get('s');
    const token = url.searchParams.get('n');
    const signing = await keys();
    if (sid && token && signing) {
      const nonce = await verifyNonce(signing, token, null, options.now(), GRACE_MS);
      if (nonce.problem === null && nonce.sid === sid) {
        await background(ctx, async () => {
          const server = deriveServerFacts(request.headers, ctx.trusted, null, null);
          const analysis = analyze({
            signals: null,
            server,
            gates: ['honeypot_trap_followed'],
            ja4Lists: options.ja4,
          });
          const decision = await decideWith(options.engine, analysis, options);
          const reasons = decision.reasons.filter((code) => code !== 'no_js');
          await emit(
            buildRecord({
              sid,
              seq: TRAP_SEQ,
              final: true,
              decision: { ...decision, reasons },
              server,
              signals: null,
              context: {},
            }),
          );
        });
      }
    }
    return respond(204, null, cors);
  }

  return {
    options,

    async handle(request, ctx) {
      const cors = corsHeaders(request);
      try {
        const url = new URL(request.url);
        const action = url.pathname.replace(/\/+$/, '').split('/').pop();
        if (request.method === 'OPTIONS') return respond(204, null, cors);

        if (action === 'init') {
          return request.method === 'GET'
            ? await handleInit(request, url, ctx, cors)
            : respond(405, null, cors);
        }
        if (action === 'score') {
          return request.method === 'POST'
            ? await handleScore(request, ctx, cors)
            : respond(405, null, cors);
        }
        if (action === 't') {
          return request.method === 'GET'
            ? await handleTrap(request, url, ctx, cors)
            : respond(405, null, cors);
        }
        return respond(404, { error: 'not_found' }, cors);
      } catch (error) {
        // Fail open: never surface an internal error to the visitor.
        options.logger.error('[realhuman] request failed', error);
        return respond(204, null, cors);
      }
    },

    async tag(request, trusted) {
      const now = options.now();
      const verifiedAgent = await verifyWebBotAuth(request, options);
      const server = deriveServerFacts(request.headers, trusted, null, verifiedAgent);
      const analysis = analyze({
        signals: null,
        server,
        ja4Lists: options.ja4,
        uaHeadless: parseUserAgent(request.headers.get('user-agent')).headless,
      });
      const decision = await decideWith(algorithmicScorer, analysis, options);
      return {
        ts: new Date(now).toISOString(),
        path: new URL(request.url).pathname,
        realHuman: decision.realHuman,
        verdict: decision.verdict,
        kind: decision.kind,
        reasons: decision.reasons,
        server,
      };
    },
  };
}

/** Reads a request body up to `limit` bytes without buffering anything larger. */
async function readBody(request: Request, limit: number): Promise<string | 'too_large'> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return 'too_large';
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return 'too_large';
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
