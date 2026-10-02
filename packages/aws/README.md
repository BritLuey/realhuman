# @realhuman/aws

Run the realHuman scoring endpoint on **AWS Lambda behind CloudFront**. Each page load gets a score
from 0 (bot) to 1 (human) for filtering your analytics. realHuman never blocks visitors.

```
Browser ──/api/realhuman/*──▶ CloudFront ──(OAC + JA4 header)──▶ Lambda function URL
```

CloudFront adds the visitor's JA4 TLS fingerprint and IP time zone, and Origin Access Control (OAC)
makes sure only your distribution can call the function.

## Install

```bash
npm install @realhuman/aws
```

Node.js 22 or newer. The CDK construct also needs `aws-cdk-lib` v2 and `constructs` v10, which your
CDK app already has.

## 1. Create a secret

```bash
aws secretsmanager create-secret \
  --name realhuman/secret \
  --secret-string "$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")"
```

## 2. Write the handler

`lambda/realhuman.ts`:

```ts
import { createLambdaHandler } from '@realhuman/aws';

export const handler = createLambdaHandler({
  onDecision: async (record) => {
    console.log(JSON.stringify({ type: 'realhuman', ...record }));
  },
});
```

`createLambdaHandler` takes every [engine option](../../docs/reference/configuration.md#engine-options),
plus `secretArnEnv` (default `'REALHUMAN_SECRET_ARN'`): the name of the environment variable holding
the secret's ARN.

Lambda freezes the function as soon as it responds, so `onDecision` runs **before** the response is
sent. Keep it quick (a log line, a Firehose `PutRecord`), and keep the Lambda timeout above
`onDecisionTimeoutMs` if it can be slow.

## 3. Deploy with CDK

```ts
import { RealHumanEndpoint } from '@realhuman/aws/cdk';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

new RealHumanEndpoint(this, 'RealHuman', {
  distribution, // your existing cloudfront.Distribution
  entry: 'lambda/realhuman.ts',
  secret: secretsmanager.Secret.fromSecretNameV2(this, 'RealHumanSecret', 'realhuman/secret'),
});
```

This creates the function (Node.js 24, ARM, 256 MB, 5 s), an IAM-protected function URL, the OAC, an
origin request policy and a `/api/realhuman/*` cache behaviour with caching disabled.

| Prop | Default | |
|---|---|---|
| `pathPattern` | `'/api/realhuman/*'` | Must match the SDK's `endpoint`. |
| `memorySize`, `timeout` | `256`, `Duration.seconds(5)` | |
| `environment` | `{}` | Extra environment variables. |
| `headers` | see below | Replaces the forwarded header list. |
| `webBotAuth` | `false` | Also forward `Signature`, `Signature-Input`, `Signature-Agent`. |
| `handler`, `runtime`, `architecture` | `'handler'`, Node.js 24, ARM_64 | |

Forwarded headers by default: `CloudFront-Viewer-JA4-Fingerprint`, `CloudFront-Viewer-Time-Zone`,
`User-Agent`, `Sec-CH-UA`, `Sec-CH-UA-Platform`, `Sec-Fetch-Site`, `Sec-Fetch-Mode`,
`x-amz-content-sha256` and `Origin`. That fits CloudFront's default quota of 10 headers per origin
request policy; `webBotAuth: true` takes it to 12, so request a quota increase first. Never forward
`Host`: the function URL rejects it.

Not using CDK? Follow the manual steps in
[Quickstart: AWS CloudFront](../../docs/getting-started/quickstart-cloudfront.md).

## 4. Start the browser SDK

```ts
import { init } from '@realhuman/client';

init({ awsContentHash: true }); // required with OAC, or POST requests fail with 403
```

## Rotating the secret

The secret value can be the base64 secret itself, or JSON with the current and previous secrets:

```json
{ "current": "NEW-BASE64-SECRET", "previous": "OLD-BASE64-SECRET" }
```

To rotate:

1. Store the JSON form, with the new secret as `current` and the old one as `previous`.
2. Redeploy the function. Running containers keep the value they loaded, and any configuration
   change replaces them.
3. A day later, remove `previous` (store just the new secret) and redeploy again.

The secret is fetched on the first request each container handles and cached. If Secrets Manager
can't be reached, the error is logged, sessions are reported as `uncertain`, and the fetch is retried
after 60 seconds.
