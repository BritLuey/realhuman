# Performance

> [!NOTE]
> The browser budgets are enforced on every build: `packages/client/scripts/bundle.mjs` fails the build if a
> bundle exceeds its budget. At the time of writing the core SDK is 8,822 bytes gzipped and each integration
> 181–316 bytes. Server figures are design targets.

realHuman must never be the reason a page feels slow.

## Browser budgets

| Budget | Target | How |
|---|---|---|
| SDK size, core | **≤ 9 KB** gzipped | No dependencies; tree-shakeable collectors |
| Each integration | ≤ 1 KB gzipped | Separate entry points, so only what you import is bundled |
| Main-thread time per input event | ≤ 0.1 ms average | Passive listeners write to fixed-size ring buffers |
| Long tasks caused by the SDK | **None** (> 50 ms) | Statistics are computed in `requestIdleCallback` |
| Effect on page load | None | Load it with `defer` or after hydration; nothing waits for it |
| Network | 1 small `GET` + 1 `POST` (≈ 2–4 KB) per page load, plus one per `score()` and one on page close | Payloads are summaries, not event streams |
| Layout reads | Only on click targets | No layout reads on mousemove |

## Server budgets

| Budget | Target |
|---|---|
| `init` endpoint | < 2 ms CPU |
| Algorithmic scoring | < 5 ms CPU at p99 |
| Response time in `server` mode | Independent of the engine; scoring runs after the response |
| Memory | Stateless: no per-session memory between requests |

## Practical tips

- **Keep the endpoint on the same domain.** It avoids extra DNS, TLS and CORS preflight round trips.
- **Don't cache the endpoint.** Use the CloudFront `CachingDisabled` policy. Vercel functions aren't cached by default.
- **Use `server` delivery** unless browser tools need the score. It's the fastest mode for the visitor.
- **Call `score()` sparingly**, at key moments like form submission rather than on every click.
