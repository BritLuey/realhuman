# Contributing to realHuman

Thanks for helping. This guide gets you from zero to a merged pull request.

## Ground rules

- Be kind. Everyone taking part must follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Security issues go to [SECURITY.md](SECURITY.md)**, not public issues.
- For anything bigger than a small fix, **open an issue first** so we can agree on the approach before you
  spend time on it.
- realHuman must never block visitors, store anything on their devices or collect raw input. Changes that
  conflict with the [privacy design](docs/operations/privacy-and-compliance.md) won't be accepted.

## Set up

You need **Node.js 22+** (see `.nvmrc`) and **pnpm 10**.

```bash
# 1. Enable pnpm via Corepack (ships with Node.js)
corepack enable

# 2. Clone and install
git clone https://github.com/your-org/realhuman.git
cd realhuman
pnpm install

# 3. Check everything works
pnpm check
```

`pnpm check` runs lint, type-checking, build and tests, the same steps as CI. If it passes locally, CI will
almost always pass.

## Repository layout

```
realhuman/
├── packages/
│   ├── schema/          @realhuman/schema: data formats and types
│   ├── client/          @realhuman/client: browser SDK and integrations
│   ├── react/           @realhuman/react: React provider and hook
│   ├── engine/          @realhuman/engine: scoring engine and re-scoring CLI
│   ├── vercel/          @realhuman/vercel: Vercel / Next.js adapter
│   ├── aws/             @realhuman/aws: Lambda handler and CDK construct
│   ├── node/            @realhuman/node: self-hosted adapter
│   └── jev/             @realhuman/jev: optional Jev engine
├── apps/demo/           local demo site (pnpm --filter @realhuman/demo start)
├── tools/bot-lab/       runs automation stacks against the demo (pnpm --filter @realhuman/bot-lab lab)
├── docs/                all user documentation
└── .changeset/          pending release notes
```

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm build` | Build every package (Turborepo, cached) |
| `pnpm test` | Run every package's tests (Vitest) |
| `pnpm typecheck` | Type-check every package |
| `pnpm lint` | Lint and format-check with Biome |
| `pnpm lint:fix` | Fix lint and formatting problems automatically |
| `pnpm check` | All of the above, the same as CI |
| `pnpm --filter @realhuman/schema test` | Run one package's tests |
| `pnpm --filter @realhuman/demo start` | Run the demo site on http://localhost:3000 |
| `pnpm --filter @realhuman/bot-lab lab` | Run the bot lab (needs Chrome or Edge installed) |

After changing anything that affects scoring, run the bot lab and check that every scenario is still scored as a bot.

## Making a change

1. **Create a branch** from `main`.
2. **Make your change**, with tests. Bug fixes need a test that fails without the fix.
3. **Update the docs** in `docs/` if behaviour, options or output change. Docs are part of the change, not an afterthought.
4. **Add a changeset** if a published package changes:
   ```bash
   pnpm changeset
   ```
   Pick the packages, pick the bump (patch / minor / major; see
   [Versioning](docs/operations/versioning-and-support.md)), and write one or two sentences for the changelog,
   written for users.
5. **Run `pnpm check`.**
6. **Open a pull request** and fill in the template.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org) style, for example
`feat(schema): add touch signal group` or `fix(client): handle missing PointerEvent`.

## Code standards

- **TypeScript strict mode**, with no `any` unless justified in a comment.
- **Formatting and linting** by Biome. Don't argue with it; run `pnpm lint:fix`.
- **Browser code must never throw into the host page** and must use passive listeners.
- **Server code must use only web-standard APIs** (`Request`, `Response`, `crypto.subtle`, `fetch`) in the
  engine, so it runs on every platform. Platform-specific code belongs in adapters.
- **No new runtime dependencies** without discussion in an issue. Every dependency is shipped to our users.
- **Data format changes** go through `@realhuman/schema` first. New fields must be optional unless it's a
  major release.
- **New reason codes** must be added to `docs/reference/reason-codes.md`. A test enforces this.

## Writing docs

Our docs are written for someone who has never seen the project before:

- Short sentences. Explain jargon or link to the [glossary](docs/glossary.md).
- Number the steps. Give copy-pasteable commands and code.
- Say how to check it worked ("✅ It worked if…").
- Pages about unreleased features start with a `> [!NOTE]` saying so.

## Releasing (maintainers)

Releases are automated. When changesets are merged to `main`, the **Release** workflow opens a "Version
Packages" pull request. Merging that PR publishes to npm with provenance.
