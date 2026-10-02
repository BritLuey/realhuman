# Security policy

## Reporting a vulnerability

**Please don't report security vulnerabilities in public issues, discussions or pull requests.**

Report them privately through GitHub's
[private vulnerability reporting](https://github.com/your-org/realhuman/security/advisories/new)
(**Security** tab → **Report a vulnerability**).

Please include:

- the affected package(s) and version(s),
- a description of the issue and its impact,
- steps to reproduce, or a proof of concept,
- any suggested fix.

## What to expect

| Step | Target time |
|---|---|
| Acknowledgement of your report | 3 business days |
| Initial assessment and severity | 10 business days |
| Fix released for critical/high severity | 30 days |
| Public advisory | When a fix is available, credited to you unless you prefer otherwise |

We'll keep you updated throughout, and we won't take legal action against good-faith research that
follows this policy.

## Supported versions

| Version | Security fixes |
|---|---|
| Latest minor of the current major | ✅ |
| Previous major | ✅ for 6 months after the next major's release |
| Pre-1.0 releases | Latest minor only |

## Scope

In scope: all `@realhuman/*` packages and the code in this repository.

Particularly interesting:

- ways to forge or replay session nonces,
- ways to make the engine trust forged network headers,
- ways to plant labels on other users' sessions,
- anything in the browser SDK that could break, slow down or leak data from a host page.

Out of scope: techniques that make a bot *score* more human. That's the arms race realHuman is designed for,
and we welcome those as regular [issues](https://github.com/your-org/realhuman/issues) labelled
`detection`. Also out of scope: vulnerabilities in your own hosting configuration.

For the design and threat model, see [docs/operations/security.md](docs/operations/security.md).
