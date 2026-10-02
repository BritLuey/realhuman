import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FORWARDED_HEADERS, RealHumanEndpoint, WEB_BOT_AUTH_HEADERS } from '../src/cdk.js';

const entry = fileURLToPath(new URL('./fixtures/handler.ts', import.meta.url));
const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';

function synth(props: { webBotAuth?: boolean; headers?: string[] } = {}) {
  const app = new App();
  const stack = new Stack(app, 'Site', { env: { account: '123456789012', region: 'eu-west-1' } });
  const distribution = new cloudfront.Distribution(stack, 'Distribution', {
    defaultBehavior: { origin: new origins.HttpOrigin('example.com') },
  });
  const secret = secretsmanager.Secret.fromSecretNameV2(stack, 'Secret', 'realhuman/secret');
  const endpoint = new RealHumanEndpoint(stack, 'RealHuman', {
    distribution,
    entry,
    secret,
    ...props,
  });
  const template = Template.fromStack(stack);
  return { template, endpoint, outdir: app.synth().directory };
}

describe('RealHumanEndpoint', () => {
  let template: Template;
  let outdir: string;
  beforeAll(() => {
    ({ template, outdir } = synth());
  }, 120_000);

  it('bundles the handler and loads the runtime AWS SDK with require()', () => {
    const asset = readdirSync(outdir).find((name) => name.startsWith('asset.'));
    expect(asset).toBeDefined();
    const code = readFileSync(join(outdir, asset ?? '', 'index.js'), 'utf8');
    expect(code).toContain('require("@aws-sdk/client-secrets-manager")');
    expect(code).toContain('cloudfront-viewer-ja4-fingerprint');
  });

  it('creates an IAM-protected function URL behind an OAC', () => {
    template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 'lambda',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4',
      }),
    });
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunctionUrl',
      Principal: 'cloudfront.amazonaws.com',
    });
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'cloudfront.amazonaws.com',
      InvokedViaFunctionUrl: true,
    });
  });

  it('configures the function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
      MemorySize: 256,
      Timeout: 5,
      Handler: 'index.handler',
      Environment: {
        Variables: Match.objectLike({ REALHUMAN_SECRET_ARN: Match.anyValue() }),
      },
    });
  });

  it('grants read access to the secret', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  it('forwards the default headers and all query strings, without Host or cookies', () => {
    const policies = template.findResources('AWS::CloudFront::OriginRequestPolicy');
    const config = Object.values(policies)[0]?.Properties.OriginRequestPolicyConfig;
    const headers: string[] = config.HeadersConfig.Headers;
    expect(config.HeadersConfig.HeaderBehavior).toBe('whitelist');
    expect(headers).toEqual([...DEFAULT_FORWARDED_HEADERS]);
    expect(headers.length).toBeLessThanOrEqual(10);
    expect(headers.map((h) => h.toLowerCase())).not.toContain('host');
    expect(config.CookiesConfig.CookieBehavior).toBe('none');
    expect(config.QueryStringsConfig.QueryStringBehavior).toBe('all');
  });

  it('adds an uncached cache behaviour for the endpoint path', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: [
          Match.objectLike({
            PathPattern: '/api/realhuman/*',
            CachePolicyId: CACHING_DISABLED,
            OriginRequestPolicyId: Match.anyValue(),
            ViewerProtocolPolicy: 'redirect-to-https',
            AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
          }),
        ],
        Origins: Match.arrayWith([Match.objectLike({ OriginAccessControlId: Match.anyValue() })]),
      }),
    });
  });

  it('adds the Web Bot Auth headers on request and refuses Host', () => {
    const { template: withWba } = synth({ webBotAuth: true });
    const config = Object.values(withWba.findResources('AWS::CloudFront::OriginRequestPolicy'))[0]
      ?.Properties.OriginRequestPolicyConfig;
    expect(config.HeadersConfig.Headers).toEqual([
      ...DEFAULT_FORWARDED_HEADERS,
      ...WEB_BOT_AUTH_HEADERS,
    ]);
    expect(() => synth({ headers: ['User-Agent', 'Host'] })).toThrow(/Host/);
  }, 120_000);
});
