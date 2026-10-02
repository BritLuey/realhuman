# Glossary

Plain-English definitions of the terms used in these docs, in alphabetical order.

### Adapter
The small package that connects the realHuman engine to your hosting platform: `@realhuman/vercel`,
`@realhuman/aws` or `@realhuman/node`. It reads the platform's trusted headers and handles the platform's
request format.

### AI Gateway (Vercel)
Vercel's service for calling AI models from many providers through one API and one bill. One of the ways
to reach [Jev](#jev).

### Bot
Any automated program that loads web pages: scrapers, crawlers, monitors, test scripts, fraud tools and
AI agents.

### Bot evidence
How much evidence of automation a session showed: `none`, `weak`, `moderate`, `strong` or `conclusive`. Strong
or conclusive makes the label `bot`; moderate makes it `suspicious`. See
[Understanding results](guides/understanding-results.md).


### CDN (Content Delivery Network)
A network of servers in front of your site that handles visitors' connections, such as Vercel's edge network or
AWS CloudFront. It can see details of the connection that your JavaScript can't.

### CDK (AWS Cloud Development Kit)
A tool for defining AWS infrastructure in code. realHuman ships a CDK *construct*, a reusable building
block, that sets up the AWS side for you.

### Client Hints
Headers such as `Sec-CH-UA` in which Chromium-based browsers describe themselves. realHuman checks they
agree with the user-agent string.

### Confidence
A number from 0 to 1 that says how much evidence a decision was based on. It's low early in a visit or when
the visitor hasn't interacted. It is separate from the score: a session can be "probably human, low confidence".

### Context
Your own join keys (for example an analytics client id) that you ask the SDK to copy into decision
records, so you can connect them to other data.

### Decision record
The full result of one update, sent to your backend through `onDecision`. See
[Data formats](reference/data-formats.md#decision-record).

### Delivery mode
Who receives results: `server` (your backend), `client` (the browser) or `both`.

### Edge
The CDN servers closest to the visitor, where requests first arrive.

### Engine
The component that works out the score: `algorithmic` (built-in rules) or `jev` (TypeSafe AI's model).

### Fail open
If something goes wrong, carry on as if nothing happened rather than breaking. realHuman fails open
everywhere: it never breaks your page or your API.

### Fetch metadata
Headers (`Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest`) that modern browsers add to every request.
Many bots forget them.

### Gate
A conclusive check, such as a filled honeypot, that settles the decision on its own without further analysis.

### Headless browser
A real browser running without a visible window, usually controlled by a program. Popular for scraping
and testing.

### HMAC
A way of signing data with a secret so it can't be altered or forged without the secret. realHuman signs
nonces with HMAC-SHA-256.

### Honeypot
A trap that people can't see but bots stumble into, such as a hidden form field. See [Honeypots](guides/honeypots.md).

### Human evidence
How much evidence of a real person a session showed: `none`, `some` or `strong`, from natural mouse movement,
typing, touch and scrolling.


### isTrusted
A property on every browser event. It's `true` when the event came from real hardware input and `false`
when a script created it.

### JA4
A fingerprint of how a client sets up a secure (TLS/HTTPS) connection: which encryption options it offers,
in what order, and so on. Every build of Chrome produces the same JA4, so it doesn't identify a person. A
Python script claiming to be Chrome, however, produces a different one. Computed by your CDN, not by
the browser. Created by FoxIO.

### Jev
A *System One model* from TypeSafe AI. Instead of writing text, it answers typed questions with
probabilities, quickly and cheaply. realHuman can use it as its engine. See [Jev engine](guides/jev-engine.md).

### Kind
A finer description of what's driving a session: `human`, `privacy_browser`, `automation`, `scraper`,
`ai_agent`, `verified_agent`, `no_js` or `unknown`.

### Label
The field to filter analytics by: `human`, `unverified`, `suspicious`, `bot` or `verified_agent`. Decided from
the [bot evidence](#bot-evidence) and [human evidence](#human-evidence) levels. See
[Understanding results](guides/understanding-results.md).


### Nonce
A single-session token. realHuman's nonces are signed by your server and tied to one visitor's connection,
so a recorded payload can't be replayed from elsewhere.

### OAC (Origin Access Control)
A CloudFront feature that signs requests to your origin, here a Lambda function URL, so the origin can
reject anything that didn't come through your distribution.

### onDecision
The function you provide to receive decision records on your backend.

### OpenRouter
A service that gives access to many AI models through one API. One of the ways to reach [Jev](#jev).

### Origin
The server behind your CDN that actually handles the request, such as your app or a Lambda function.

### Privacy browser
A browser that deliberately hides or randomises details to resist tracking, such as Brave, Tor Browser or
Firefox with resistFingerprinting. realHuman recognises these so their users aren't mistaken for bots.

### Primary reason
The single reason code that best explains a session's label, such as `pointer_natural` ("Natural mouse
movement"). Handy for dashboards.


### Reason code
A short label in a decision record explaining part of a decision, such as `pointer_natural`.
See [Reason codes](reference/reason-codes.md).

### realHuman score
A number from 0 to 1 for ranking sessions: higher means more human-like evidence. It is **not** a probability.
Filter on the [label](#label) instead.

### seq
The update number within one page load: `0` for the first, then `1`, `2`… The highest is the latest.

### Shadow mode
Running a second engine alongside the main one and recording its answer without using it. Used to compare
engines safely. See [Shadow mode](guides/shadow-mode.md).

### sid
The session id: random, one per page load, never stored on the device.

### Signals
The summaries the browser SDK collects, such as pointer movement statistics.
See [Signals](reference/signals.md).

### System One model
TypeSafe AI's name for models built to make fast, structured decisions inside software, as opposed to chat
models that write text.

### TLS
The encryption behind HTTPS. Its handshake is where the [JA4](#ja4) fingerprint comes from.

### Upsert
"Insert, or update if it already exists": how you store decision records so each `sid` keeps only its latest update.

### Verdict
A coarser version of the [label](#label), kept for compatibility: `human`, `bot`, `verified_agent` or
`uncertain` (which covers both `unverified` and `suspicious`).

### Verified agent
An AI agent or crawler that proves who it is by cryptographically signing its requests with
[Web Bot Auth](#web-bot-auth).

### Web Bot Auth
An emerging IETF standard that lets bots and AI agents sign their HTTP requests, so sites can verify who
they are.

### WAF (Web Application Firewall)
A service that inspects and blocks malicious traffic. realHuman is *not* a WAF and blocks nothing; use one
alongside it if you need blocking.
