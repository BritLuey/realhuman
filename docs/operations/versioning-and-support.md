# Versioning & support

## Release versioning

All packages follow [Semantic Versioning](https://semver.org):

| Change | Version bump | Example |
|---|---|---|
| Bug fix | Patch | 1.4.**2** → 1.4.**3** |
| New feature, new optional field, new reason code | Minor | 1.**4**.3 → 1.**5**.0 |
| Anything that could break your code or data pipeline | Major | **1**.5.0 → **2**.0.0 |

**Before 1.0.0** the API may still change between minor versions (for example 0.3 → 0.4). Every such change
is listed in the package changelog under **Breaking**.

Releases are managed with [Changesets](https://github.com/changesets/changesets). Each package has a
`CHANGELOG.md` with every change.

## Data format versioning

Every payload, response and record carries `"v": 1`, which is versioned **separately** from the packages:

- **Additive changes** (new optional fields, new reason codes, new `kind` values) do **not** change `v`.
  Consumers must ignore unknown fields and treat unknown codes as neutral.
- **Breaking changes** to the data format increase `v` and ship in a major package release. The engine will
  accept the previous `v` for at least one major version, so browser and server can be upgraded
  independently.

Decision records also carry `engineVersion`, so you can always tell which logic produced a label, and
re-score old records with `realhuman-rescore` when the rules change.

## Supported platforms

| Platform | Supported |
|---|---|
| **Node.js** | Active and maintenance LTS releases (currently 22 and 24). Support for a version ends when it reaches end-of-life. |
| **Browsers** | The last two major versions of Chrome, Edge, Firefox and Safari; Safari on iOS 16.4+. Older browsers are never broken: the SDK detects missing features and sends less evidence. |
| **Vercel** | Vercel Functions (Node.js and Edge runtimes), Next.js 15+ |
| **AWS** | Lambda Node.js 22+ runtimes, CDK v2 |
| **TypeScript** | Types are tested against the current TypeScript release |

## Deprecation policy

1. A deprecated option or API keeps working, and logs a one-time warning, for at least **one minor release**
   before removal.
2. Removal only happens in a **major** release.
3. The changelog and the docs both name the replacement.

## Security support

Security fixes are released for the **latest minor version** of the current major. After a new major
release, the previous major gets security fixes for **6 months**. See [SECURITY.md](../../SECURITY.md).

## Supply chain

- **Minimal dependencies.** `@realhuman/schema` depends only on [`valibot`](https://valibot.dev). The browser SDK will have no runtime dependencies at all.
- **Provenance.** Every package is published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), so you can verify that the package on npm was built from this repository's source.
- **Trusted publishing.** Releases use npm's OIDC trusted publishing; no long-lived npm tokens exist.
- **Pinned CI.** CI installs with a frozen lockfile, and dependency updates arrive as reviewed pull requests from Dependabot.

Verify a package's provenance with:

```bash
npm audit signatures
```
