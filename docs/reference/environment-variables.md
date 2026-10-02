# Environment variables

> [!NOTE]
> **Planned: milestones M2–M5.** This page lists the intended variables.

realHuman never asks you to put secrets in code. Instead, you tell it the **name** of an environment
variable, and it reads the value at runtime. Every name below is a default you can change with the matching
option.

| Variable | Required? | Read by | Option that changes the name | Contents |
|---|---|---|---|---|
| `REALHUMAN_SECRET` | **Yes** (unless `REALHUMAN_SECRET_ARN` is used on AWS) | Engine | `secretEnv` | Signing secret: at least 32 random bytes, base64-encoded |
| `REALHUMAN_SECRET_PREVIOUS` | Only while rotating | Engine | `previousSecretEnv` | The old secret, still accepted for verification. See [rotation](../operations/security.md#rotating-the-secret). |
| `REALHUMAN_SECRET_ARN` | AWS only, instead of `REALHUMAN_SECRET` | AWS adapter | `secretArnEnv` | ARN of a Secrets Manager secret holding the signing secret. Set automatically by the CDK construct. |
| `AI_GATEWAY_API_KEY` | Jev via Vercel AI Gateway, outside Vercel | Jev engine | `apiKeyEnv` | Vercel AI Gateway API key |
| `VERCEL_OIDC_TOKEN` | No (set by Vercel) | Jev engine | – | Used automatically for AI Gateway on Vercel when no API key is set |
| `OPENROUTER_API_KEY` | Jev via OpenRouter | Jev engine | `apiKeyEnv` | OpenRouter API key |
| `TYPESAFE_AI_API_KEY` | Jev via TypeSafe directly | Jev engine | `apiKeyEnv` | TypeSafe AI API key |

## Generating a secret

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

or

```bash
openssl rand -base64 32
```

## Rules

- **Every server instance must use the same secret.** A nonce issued by one instance must verify on another.
- **Never expose these to the browser.** In Next.js, never prefix them with `NEXT_PUBLIC_`.
- **At start-up**, realHuman logs a clear error if the secret is missing or shorter than 32 bytes, and
  answers every request with `verdict: "uncertain"` until that's fixed. It never crashes your app.
- **Custom secret stores:** pass `env: (name) => mySecrets[name]` to read from somewhere other than
  `process.env`. The function must be synchronous, so load the values at start-up.
