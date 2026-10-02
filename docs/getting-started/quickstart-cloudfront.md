# Quickstart: AWS CloudFront

> [!NOTE]
> **Planned: milestones M1, M2 and M4.** This guide shows the intended setup so you can plan your integration.
> It will work once `@realhuman/client`, `@realhuman/engine` and `@realhuman/aws` are released. See the [roadmap](../roadmap.md).

**Time needed:** about 20 minutes with CDK, or 40 minutes by hand.
**You'll end up with:** CloudFront sending `/api/realhuman/*` to a Lambda function that scores each page
load, with results in CloudWatch Logs.

## How the pieces fit

```mermaid
flowchart LR
    B[Browser + SDK] -->|/api/realhuman/*| CF[CloudFront]
    CF -->|adds JA4 + headers<br/>signs request with OAC| L[Lambda function URL<br/>realHuman engine]
    L -->|onDecision| D[(CloudWatch / Firehose /<br/>your pipeline)]
    CF -->|everything else| O[Your existing origin]
```

CloudFront works out the visitor's **JA4 TLS fingerprint** and passes it to the Lambda function in the
`CloudFront-Viewer-JA4-Fingerprint` header. The Lambda function only accepts requests that come through your
distribution, enforced by Origin Access Control (OAC), so nobody can call it directly with a forged
fingerprint.

## Before you start

You need:

- [ ] An existing CloudFront distribution in front of your site
- [ ] Node.js 22 or newer on your computer
- [ ] For option A: an AWS CDK v2 app that defines (or can define) that distribution
- [ ] Permission to create Lambda functions, Secrets Manager secrets and CloudFront policies

## Step 1: Create a secret

realHuman signs its session tokens with a secret. Store one in AWS Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name realhuman/secret \
  --secret-string "$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")"
```

The Lambda function loads it at start-up, so the secret never appears in your code or environment
variables.

## Step 2: Write the Lambda handler

Install the package in your CDK app:

```bash
npm install @realhuman/aws
```

Create **`lambda/realhuman.ts`**:

```ts
import { createLambdaHandler } from '@realhuman/aws';

export const handler = createLambdaHandler({
  // Every decision. Logging to CloudWatch is the simplest start;
  // a CloudWatch subscription or Firehose can carry it to your warehouse.
  onDecision: async (record) => {
    console.log(JSON.stringify({ type: 'realhuman', ...record }));
  },
});
```

## Step 3, option A (recommended): Deploy with the CDK construct

In your stack, next to your distribution:

```ts
import { RealHumanEndpoint } from '@realhuman/aws/cdk';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

new RealHumanEndpoint(this, 'RealHuman', {
  distribution, // your existing cloudfront.Distribution
  entry: 'lambda/realhuman.ts',
  secret: secretsmanager.Secret.fromSecretNameV2(this, 'RealHumanSecret', 'realhuman/secret'),
});
```

Then deploy:

```bash
npx cdk deploy
```

The construct creates and wires up:

| Resource | Purpose |
|---|---|
| Lambda function + function URL | Runs the engine |
| Origin Access Control | Only your distribution can call the function |
| Cache behaviour `/api/realhuman/*` | Routes SDK traffic to the function, with caching disabled |
| Origin request policy | Forwards the headers the engine needs (list below) |
| IAM permission | Lets the function read the secret |

Skip to [Step 4](#step-4-start-the-sdk-in-the-browser).

## Step 3, option B: Set it up by hand

Use this if your distribution isn't managed by CDK.

1. **Create the Lambda function.** Bundle `lambda/realhuman.ts` (for example with `esbuild --bundle --platform=node --target=node22`), then create a Node.js 22+ function from it with 256 MB of memory and a 5-second timeout.
2. **Give it the secret.** Set the environment variable `REALHUMAN_SECRET_ARN` to the ARN of `realhuman/secret`, and give the function's role `secretsmanager:GetSecretValue` on that secret.
3. **Add a function URL** with auth type **AWS_IAM**.
4. **Add the function URL as an origin** of your distribution, with a new **Origin Access Control** of type *Lambda*. Add the resource policy the console offers so CloudFront can invoke the URL.
5. **Create an origin request policy** that forwards these headers:

   | Header | Why |
   |---|---|
   | `CloudFront-Viewer-JA4-Fingerprint` | TLS fingerprint |
   | `CloudFront-Viewer-Time-Zone` | IP time zone |
   | `User-Agent` | Claimed browser |
   | `Accept-Language` | Consistency check |
   | `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform` | Client Hints |
   | `Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest` | Fetch metadata |
   | `Signature`, `Signature-Input`, `Signature-Agent` | Web Bot Auth (verified AI agents) |
   | `x-amz-content-sha256` | Required by OAC for POST bodies |

   Do **not** forward the `Host` header to a Lambda function URL, or requests will fail with 403.
   If you hit the limit on headers per policy, ask AWS for a quota increase.
6. **Add a cache behaviour** for the path pattern `/api/realhuman/*`: allowed methods *GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE*, cache policy **CachingDisabled**, and the origin request policy from step 5.

## Step 4: Start the SDK in the browser

Install the SDK in your website project:

```bash
npm install @realhuman/client
```

and start it on every page:

```ts
import { init } from '@realhuman/client';

init({
  awsContentHash: true, // required with OAC: lets CloudFront sign POST requests to Lambda
});
```

> [!IMPORTANT]
> `awsContentHash: true` is required for CloudFront + Lambda function URLs with OAC. Without it, every
> score request fails with **403**. It adds a SHA-256 hash of the request body in a header, which AWS needs
> to sign the request.

No build step? Use the script tag instead:

```html
<script src="/realhuman.js" data-aws-content-hash="true" defer></script>
```

(Copy `node_modules/@realhuman/client/dist/realhuman.iife.js` to your site as `/realhuman.js`. Hosting
it on your own domain avoids ad blockers.)

## Step 5: Check it works

1. Open your site in a normal browser, move the mouse and scroll for a few seconds.
2. In the AWS console, open **CloudWatch → Log groups** and find the function's log group.
3. Search for `realhuman`.

✅ **It worked if** you see decision records with a `realHuman` score and a non-null `server.ja4`.

`server.ja4` is `null`? The origin request policy isn't forwarding `CloudFront-Viewer-JA4-Fingerprint`;
recheck step 3. Other problems: [Troubleshooting](../operations/troubleshooting.md).

## Optional next steps

| Want to… | Do this |
|---|---|
| Send results to S3, Redshift, Snowflake or BigQuery | Use Kinesis Data Firehose in `onDecision`. See [Ingesting decisions](../guides/ingesting-decisions.md) |
| Show the score to New Relic, Datadog or GA4 | Set `deliver: 'both'`. See [Frontend integrations](../guides/frontend-integrations.md) |
| Add honeypots to your forms | [Honeypots](../guides/honeypots.md) |
| Use the Jev engine | [Jev engine](../guides/jev-engine.md) |

> [!NOTE]
> **Why not Lambda@Edge?** It works, but it can't use environment variables, must be deployed in
> `us-east-1`, and takes longer to roll out changes. A regional Lambda function behind CloudFront is simpler
> to run and is fast enough for this job. It's still documented as an alternative in
> [Configuration](../reference/configuration.md#aws-adapter).
