# realHuman Vercel demo

A Next.js site you can host on Vercel in about ten minutes. It:

- scores every visit and shows visitors their own score and the reasons for it;
- runs the exact setup from the [Vercel quickstart](../../docs/getting-started/quickstart-vercel.md), including edge tagging in `proxy.ts`;
- collects **labelled sessions** (`?label=human`, `?label=bot`) and exports them for the
  [evaluation tool](../../tools/eval), so you can measure how well realHuman works on real people and real bots.

## Deploy it

### 1. Put the repository on GitHub

Push this repository to your GitHub account (or organisation).

### 2. Import it into Vercel

1. Go to <https://vercel.com/new> and choose your repository.
2. **Root Directory:** click *Edit* and choose `apps/vercel-demo`.
3. Leave the framework preset as **Next.js**. The build command comes from `vercel.json`; it builds the realHuman packages first.

### 3. Add environment variables

Still on the import screen, open **Environment Variables** and add:

| Name | Value | Required? |
|---|---|---|
| `REALHUMAN_SECRET` | Output of `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` | **Yes** |
| `DEMO_ADMIN_TOKEN` | Another long random value (run the same command again) | For exporting results |

Click **Deploy**.

### 4. Connect storage (recommended)

Without storage the demo still works, but it can't show reason codes on the page or export results.

1. In your Vercel project, open **Storage** → **Create Database** (or **Marketplace**) → **Upstash for Redis**.
2. Choose the free plan and connect it to this project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.
3. **Redeploy** (Deployments → ⋯ → Redeploy) so the new variables take effect.

### 5. Check it works

Open your deployment URL. Within a second you should see a score. Move the mouse, scroll, type in the form and
press **Score now**. The **Why this score?** panel lists the reason codes, and the TLS fingerprint line should
show a JA4 value (for example `t13d1516h2_…`). That's Vercel's edge at work.

✅ If the score, the reasons and a JA4 value all appear, the deployment is complete.

## Use it to test realHuman

| Link | What it records |
|---|---|
| `https://<your-demo>/` | Unlabelled visits |
| `https://<your-demo>/?label=human&run=pilot-1` | Sessions you know are human. Send this to colleagues, friends or testers |
| `https://<your-demo>/?label=human&run=pilot-1&participant=p07` | The same, with a participant code so you can follow up |
| bot lab: `pnpm --filter @realhuman/bot-lab lab -- --target=https://<your-demo> --run=pilot-1 --repeat=10` | Labelled bot sessions from 11 automation techniques |

Then build the report:

```bash
DEMO_ADMIN_TOKEN=<your token> pnpm --filter @realhuman/eval report -- --url=https://<your-demo> --run=pilot-1
```

The full method is in [Proving it works](../../docs/guides/evaluation.md).

## Run it locally

```bash
pnpm install
pnpm build
cp apps/vercel-demo/.env.example apps/vercel-demo/.env.local   # then fill in REALHUMAN_SECRET
pnpm --filter @realhuman/vercel-demo dev
```

Locally there's no JA4 (no Vercel edge), and no storage unless you add Upstash variables to `.env.local`.

## Privacy

The demo stores decision records (summaries of interaction, never what people type) for 30 days in your Upstash
database, labelled only with what's in the test link. Tell testers this before sending them a link.
