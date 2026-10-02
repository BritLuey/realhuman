import type { DecisionRecord } from '@realhuman/engine';
import type { LambdaFunctionURLResult as AwsResult } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLambdaHandler, type LambdaHandlerOptions } from '../src/index.js';
import { type InitBody, OTHER_SECRET, payload, SECRET, silentLogger, urlEvent } from './helpers.js';

const sm = vi.hoisted(() => ({
  send: vi.fn<(input: { SecretId: string }) => Promise<Record<string, unknown>>>(),
  regions: [] as unknown[],
}));

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    constructor(config: { region?: string }) {
      sm.regions.push(config.region);
    }
    send(command: { input: { SecretId: string } }) {
      return sm.send(command.input);
    }
  },
  GetSecretValueCommand: class {
    constructor(readonly input: { SecretId: string }) {}
  },
}));

const ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:realhuman/secret-AbCdEf';

function envWith(values: Record<string, string>) {
  return (name: string) => values[name];
}

function bodyOf(result: AwsResult): InitBody {
  if (typeof result === 'string' || result.body === undefined) throw new Error('no body');
  return JSON.parse(result.body) as InitBody;
}

async function configured(handler: ReturnType<typeof createLambdaHandler>): Promise<boolean> {
  const init = bodyOf(await handler(urlEvent('GET', '/api/realhuman/init')));
  return !init.nonce.startsWith('unconfigured.');
}

beforeEach(() => {
  sm.send.mockReset();
  sm.regions.length = 0;
});

describe('secret loading', () => {
  it('loads a raw secret once and caches it', async () => {
    sm.send.mockResolvedValue({ SecretString: SECRET });
    // REALHUMAN_SECRET in the environment is ignored once an ARN is configured.
    const handler = createLambdaHandler({
      env: envWith({ REALHUMAN_SECRET_ARN: ARN, REALHUMAN_SECRET: 'too-short' }),
      logger: silentLogger,
    });
    expect(await configured(handler)).toBe(true);
    expect(await configured(handler)).toBe(true);
    expect(sm.send).toHaveBeenCalledTimes(1);
    expect(sm.send).toHaveBeenCalledWith({ SecretId: ARN });
    expect(sm.regions).toEqual(['us-east-1']);
  });

  it('shares one request between concurrent cold-start invocations', async () => {
    sm.send.mockResolvedValue({ SecretString: SECRET });
    const handler = createLambdaHandler({
      env: envWith({ REALHUMAN_SECRET_ARN: ARN }),
      logger: silentLogger,
    });
    expect(await Promise.all([configured(handler), configured(handler)])).toEqual([true, true]);
    expect(sm.send).toHaveBeenCalledTimes(1);
  });

  it('accepts JSON with current and previous secrets for rotation', async () => {
    // A nonce signed with the old secret…
    const old = createLambdaHandler({
      env: envWith({ REALHUMAN_SECRET: OTHER_SECRET }),
      logger: silentLogger,
    });
    const { sid, nonce } = bodyOf(await old(urlEvent('GET', '/api/realhuman/init')));

    // …is still accepted once the secret has been rotated.
    sm.send.mockResolvedValue({
      SecretString: JSON.stringify({ current: SECRET, previous: OTHER_SECRET }),
    });
    const records: DecisionRecord[] = [];
    const options: LambdaHandlerOptions = {
      env: envWith({ MY_ARN: ARN }),
      secretArnEnv: 'MY_ARN',
      logger: silentLogger,
      onDecision: (record) => {
        records.push(record);
      },
    };
    const handler = createLambdaHandler(options);
    const body = JSON.stringify(payload(sid, nonce));
    await handler(urlEvent('POST', '/api/realhuman/score', { body }));
    expect(records).toHaveLength(1);
    expect(records[0]?.reasons).not.toContain('nonce_invalid');
    expect(sm.send).toHaveBeenCalledWith({ SecretId: ARN });
  });

  it('retries 60 s after a failure and reports uncertain meanwhile', async () => {
    let clock = 1_790_000_000_000;
    const errors: unknown[][] = [];
    sm.send.mockRejectedValueOnce(new Error('AccessDenied'));
    sm.send.mockResolvedValue({ SecretString: SECRET });
    const handler = createLambdaHandler({
      env: envWith({ REALHUMAN_SECRET_ARN: ARN }),
      logger: { ...silentLogger, error: (...args: unknown[]) => errors.push(args) },
      now: () => clock,
    });

    expect(await configured(handler)).toBe(false);
    expect(sm.send).toHaveBeenCalledTimes(1);
    expect(String(errors[0]?.[0])).toContain('Secrets Manager');

    clock += 30_000;
    expect(await configured(handler)).toBe(false);
    expect(sm.send).toHaveBeenCalledTimes(1);

    clock += 31_000;
    expect(await configured(handler)).toBe(true);
    expect(sm.send).toHaveBeenCalledTimes(2);
  });

  it('treats invalid JSON secrets as a failure', async () => {
    sm.send.mockResolvedValue({ SecretString: '{"previous":"x"}' });
    const handler = createLambdaHandler({
      env: envWith({ REALHUMAN_SECRET_ARN: ARN }),
      logger: silentLogger,
    });
    expect(await configured(handler)).toBe(false);
  });

  it('does not call Secrets Manager without an ARN', async () => {
    const handler = createLambdaHandler({
      env: envWith({ REALHUMAN_SECRET: SECRET }),
      logger: silentLogger,
    });
    expect(await configured(handler)).toBe(true);
    expect(sm.send).not.toHaveBeenCalled();
  });
});
