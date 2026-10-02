import { Duration } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * Headers forwarded to the function by default. CloudFront's default quota is 10 headers per
 * origin request policy, so this list stays within it. Never add `Host`: a Lambda function URL
 * rejects requests whose Host isn't its own.
 */
export const DEFAULT_FORWARDED_HEADERS: readonly string[] = [
  'CloudFront-Viewer-JA4-Fingerprint',
  'CloudFront-Viewer-Time-Zone',
  'User-Agent',
  'Sec-CH-UA',
  'Sec-CH-UA-Platform',
  'Sec-Fetch-Site',
  'Sec-Fetch-Mode',
  // OAC needs the SDK's body hash to sign POST requests to the function URL.
  'x-amz-content-sha256',
  'Origin',
];

/** Added when `webBotAuth` is on. Takes the list past 10, so it needs a quota increase. */
export const WEB_BOT_AUTH_HEADERS: readonly string[] = [
  'Signature',
  'Signature-Input',
  'Signature-Agent',
];

export interface RealHumanEndpointProps {
  /** The distribution to add the cache behaviour to. */
  readonly distribution: cloudfront.Distribution;
  /** Path to your handler file, bundled with esbuild. */
  readonly entry: string;
  /** The signing secret. The function may read it and gets its ARN in `REALHUMAN_SECRET_ARN`. */
  readonly secret: secretsmanager.ISecret;
  /** Cache behaviour path; must match the SDK's `endpoint`. Default `'/api/realhuman/*'`. */
  readonly pathPattern?: string;
  /** Lambda memory in MB. Default 256. */
  readonly memorySize?: number;
  /** Lambda timeout. Default 5 seconds. Raise it if `onDecision` or Jev needs longer. */
  readonly timeout?: Duration;
  /** Extra environment variables. */
  readonly environment?: Readonly<Record<string, string>>;
  /** Replaces the forwarded header allow-list. Default `DEFAULT_FORWARDED_HEADERS`. */
  readonly headers?: readonly string[];
  /**
   * Also forward the Web Bot Auth headers (`Signature`, `Signature-Input`, `Signature-Agent`).
   * That is 12 headers with the default list, above CloudFront's default quota of 10. Default false.
   */
  readonly webBotAuth?: boolean;
  /** Exported handler name in `entry`. Default `'handler'`. */
  readonly handler?: string;
  /** Default Node.js 24 (Node.js 22 with older aws-cdk-lib versions). */
  readonly runtime?: lambda.Runtime;
  /** Default ARM_64. */
  readonly architecture?: lambda.Architecture;
}

/**
 * A Lambda function URL running the realHuman handler, reachable only through `distribution`
 * (Origin Access Control) at `pathPattern`, with caching disabled and the headers the engine needs.
 */
export class RealHumanEndpoint extends Construct {
  readonly fn: NodejsFunction;
  readonly functionUrl: lambda.FunctionUrl;
  readonly originRequestPolicy: cloudfront.OriginRequestPolicy;

  constructor(scope: Construct, id: string, props: RealHumanEndpointProps) {
    super(scope, id);

    const headers = [
      ...new Set([
        ...(props.headers ?? DEFAULT_FORWARDED_HEADERS),
        ...(props.webBotAuth ? WEB_BOT_AUTH_HEADERS : []),
      ]),
    ];
    if (headers.some((header) => header.toLowerCase() === 'host')) {
      throw new Error(
        '[realhuman] Do not forward the Host header: Lambda function URLs reject requests for other hosts.',
      );
    }

    this.fn = new NodejsFunction(this, 'Function', {
      entry: props.entry,
      handler: props.handler ?? 'handler',
      runtime: props.runtime ?? defaultRuntime(),
      architecture: props.architecture ?? lambda.Architecture.ARM_64,
      memorySize: props.memorySize ?? 256,
      timeout: props.timeout ?? Duration.seconds(5),
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        ...props.environment,
        REALHUMAN_SECRET_ARN: props.secret.secretArn,
      },
      bundling: {
        // The AWS SDK ships with the Lambda runtime.
        externalModules: ['@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        // Turn `import('@aws-sdk/…')` into `require()`: the runtime's SDK is found through
        // NODE_PATH, which only CommonJS resolution honours.
        esbuildArgs: { '--supported:dynamic-import': 'false' },
      },
    } satisfies NodejsFunctionProps);
    props.secret.grantRead(this.fn);

    this.functionUrl = this.fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    this.originRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'OriginRequestPolicy', {
      comment: 'realHuman: forwards the headers the scoring engine reads',
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(...headers),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      // The trap link uses `s` and `n`, and `init` uses `refresh`.
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
    });

    // Signs every request from CloudFront; the origin also grants CloudFront lambda:InvokeFunctionUrl.
    const originAccessControl = new cloudfront.FunctionUrlOriginAccessControl(
      this,
      'OriginAccessControl',
    );
    const origin = origins.FunctionUrlOrigin.withOriginAccessControl(this.functionUrl, {
      originAccessControl,
    });
    props.distribution.addBehavior(props.pathPattern ?? '/api/realhuman/*', origin, {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: this.originRequestPolicy,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    });

    // Function URLs created since October 2025 also need lambda:InvokeFunction, limited to calls
    // that arrive through the function URL.
    this.fn.addPermission('InvokeFromCloudFront', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      invokedViaFunctionUrl: true,
      sourceArn: props.distribution.distributionArn,
    });
  }
}

function defaultRuntime(): lambda.Runtime {
  // NODEJS_24_X is missing from older aws-cdk-lib releases that the peer range still allows.
  const runtimes = lambda.Runtime as { NODEJS_24_X?: lambda.Runtime };
  return runtimes.NODEJS_24_X ?? lambda.Runtime.NODEJS_22_X;
}
