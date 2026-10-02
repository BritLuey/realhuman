# Performance

> [!NOTE]
> These are **targets** for the planned packages (milestones M1–M5). From M1 onwards they will be enforced in
> CI, and a release that exceeds a budget will fail its build.

realHuman must never be the reason a page feels slow.

## Browser budgets

| Budget | Target | How |
|---|---|---|
| SDK size, core | **≤ 8 KB** gzipped | No dependencies; tree-shakeable collectors |
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
| Jev scoring | 70–500 ms typical, hard cap `timeoutMs` (default 800 ms) |
| Response time in `server` mode | Independent of the engine; scoring runs after the response |
| Memory | Stateless: no per-session memory between requests |

## Practical tips

- **Keep the endpoint on the same domain.** It avoids extra DNS, TLS and CORS preflight round trips.
- **Don't cache the endpoint.** Use the CloudFront `CachingDisabled` policy. Vercel functions aren't cached by default.
- **Use `server` delivery** unless browser tools need the score. It's the fastest mode for the visitor.
- **Call `score()` sparingly**, at key moments like form submission rather than on every click.
