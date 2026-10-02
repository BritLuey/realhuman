import type { ClientResult, DecisionRecord } from '@realhuman/engine';
import type { LambdaFunctionURLResult as AwsResult } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { createLambdaHandler, toRequest, toResult, trustedFacts } from '../src/index.js';
import {
  CHROME_JA4,
  cloudFrontHeaders,
  type InitBody,
  payload,
  SECRET,
  silentLogger,
  urlEvent,
} from './helpers.js';

const env = (name: string) => (name === 'REALHUMAN_SECRET' ? SECRET : undefined);

function json<T>(result: AwsResult): T {
  if (typeof result === 'string' || result.body === undefined) throw new Error('no body');
  return JSON.parse(result.body) as T;
}

describe('createLambdaHandler', () => {
  it('runs init then score end to end and passes the CloudFront JA4 to onDecision', async () => {
    const records: DecisionRecord[] = [];
    const handler = createLambdaHandler({
      env,
      deliver: 'both',
      logger: silentLogger,
      onDecision: (record) => {
        records.push(record);
      },
    });

    const init: AwsResult = await handler(urlEvent('GET', '/api/realhuman/init'));
    expect(typeof init === 'object' && init.statusCode).toBe(200);
    const { sid, nonce } = json<InitBody>(init);
    expect(sid).toMatch(/\S/);
    expect(nonce.startsWith('unconfigured.')).toBe(false);

    const body = JSON.stringify(payload(sid, nonce));
    const score = await handler(
      urlEvent('POST', '/api/realhuman/score', {
        headers: cloudFrontHeaders({ 'content-type': 'application/json' }),
        body,
      }),
    );
    expect(typeof score === 'object' && score.statusCode).toBe(200);
    const result = json<ClientResult>(score);
    expect(result).toMatchObject({ v: 1, sid, seq: 0 });
    expect(typeof result.realHuman).toBe('number');

    // No waitUntil on Lambda: onDecision has finished by the time the response is returned.
    expect(records).toHaveLength(1);
    expect(records[0]?.server.ja4).toBe(CHROME_JA4);
    expect(records[0]?.server.timezoneMatch).toBe(true);
    expect(records[0]?.reasons).not.toContain('nonce_invalid');
    expect(records[0]?.context).toEqual({ gaClientId: '1234567890.1700000000' });
  });

  it('decodes base64 bodies', async () => {
    const records: DecisionRecord[] = [];
    const handler = createLambdaHandler({
      env,
      deliver: 'server',
      logger: silentLogger,
      onDecision: (record) => {
        records.push(record);
      },
    });
    const { sid, nonce } = json<InitBody>(await handler(urlEvent('GET', '/api/realhuman/init')));
    const body = Buffer.from(JSON.stringify(payload(sid, nonce))).toString('base64');
    const score = await handler(urlEvent('POST', '/api/realhuman/score', { body, base64: true }));
    expect(score).toMatchObject({ statusCode: 204 });
    expect(records).toHaveLength(1);
    expect(records[0]?.sid).toBe(sid);
  });

  it('answers unknown routes with 404', async () => {
    const handler = createLambdaHandler({ env, logger: silentLogger, onDecision() {} });
    const result = await handler(urlEvent('GET', '/api/realhuman/nope'));
    expect(result).toMatchObject({ statusCode: 404 });
    expect(json(result)).toEqual({ error: 'not_found' });
  });

  it('reports uncertain without a secret', async () => {
    const handler = createLambdaHandler({ env: () => undefined, logger: silentLogger });
    const init = await handler(urlEvent('GET', '/api/realhuman/init'));
    expect(json<InitBody>(init).nonce.startsWith('unconfigured.')).toBe(true);
  });

  it('never throws on malformed events', async () => {
    const handler = createLambdaHandler({ env, logger: silentLogger, onDecision() {} });
    const result = await handler({ rawPath: '/x' } as never);
    expect(result).toMatchObject({ statusCode: 204 });
  });

  it('rejects invalid configuration when the handler is created', () => {
    expect(() => createLambdaHandler({ deliver: 'nope' as never, logger: silentLogger })).toThrow(
      TypeError,
    );
  });
});

describe('toRequest', () => {
  it('builds the URL from the forwarded host, path and query', () => {
    const request = toRequest(
      urlEvent('GET', '/api/realhuman/t', {
        query: 's=abc&n=def',
        headers: cloudFrontHeaders({ 'x-forwarded-host': 'www.example.com' }),
      }),
    );
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://www.example.com/api/realhuman/t?s=abc&n=def');
    expect(request.headers.get('user-agent')).toContain('Chrome/141');
    expect(request.body).toBeNull();
  });

  it('falls back to the host header and ignores bodies on GET', () => {
    const request = toRequest(urlEvent('GET', '/a', { body: 'ignored' }));
    expect(request.url).toBe('https://abc123.lambda-url.eu-west-1.on.aws/a');
    expect(request.body).toBeNull();
  });

  it('decodes base64 bodies', async () => {
    const body = Buffer.from('{"hello":"wörld"}').toString('base64');
    const request = toRequest(urlEvent('POST', '/a', { body, base64: true }));
    expect(await request.text()).toBe('{"hello":"wörld"}');
  });
});

describe('toResult', () => {
  it('copies status, headers and body', async () => {
    const response = new Response('{"ok":true}', {
      status: 201,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
    expect(await toResult(response)).toEqual({
      statusCode: 201,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: '{"ok":true}',
      isBase64Encoded: false,
    });
  });

  it('omits the body of empty responses and base64-encodes binary ones', async () => {
    expect(await toResult(new Response(null, { status: 204 }))).toEqual({
      statusCode: 204,
      headers: {},
    });
    const binary = await toResult(
      new Response(new Uint8Array([0, 255]), {
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    expect(binary).toMatchObject({ body: 'AP8=', isBase64Encoded: true });
  });
});

describe('trustedFacts', () => {
  it('reads the CloudFront viewer headers', () => {
    expect(trustedFacts(new Headers(cloudFrontHeaders()))).toEqual({
      ja4: CHROME_JA4,
      ipTimezone: 'Europe/London',
    });
    expect(trustedFacts(new Headers())).toEqual({ ja4: null, ipTimezone: null });
  });
});
