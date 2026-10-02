/**
 * Reason codes explain *why* a session received its score.
 *
 * They are written to the server-side decision record only. They are never sent
 * to the browser, so automated clients get no feedback to tune against.
 *
 * - `lean`: which way the reason pushes the score.
 * - `group`: where the evidence came from.
 */
export type ReasonLean = 'bot' | 'human' | 'neutral';
export type ReasonGroup = 'gate' | 'environment' | 'network' | 'behaviour' | 'engine';

export interface ReasonInfo {
  /** Short, human-readable name for dashboards, e.g. "Headless browser traits". */
  readonly title: string;
  readonly group: ReasonGroup;
  readonly lean: ReasonLean;
  readonly description: string;
}

export const REASONS = {
  // Gates: decisive on their own. The session is scored as a bot without further analysis.
  honeypot_filled: {
    title: 'Honeypot filled',
    group: 'gate',
    lean: 'bot',
    description: 'A hidden honeypot form field was filled in.',
  },
  honeypot_trap_followed: {
    title: 'Trap link followed',
    group: 'gate',
    lean: 'bot',
    description: 'An invisible trap link was followed.',
  },
  agent_canary_followed: {
    title: 'Followed hidden AI-agent instructions',
    group: 'gate',
    lean: 'bot',
    description: 'Hidden instructions aimed at AI agents were acted on.',
  },
  nonce_invalid: {
    title: 'Invalid session token',
    group: 'gate',
    lean: 'bot',
    description: 'The session nonce was missing, malformed or had a bad signature.',
  },
  nonce_expired: {
    title: 'Expired session token',
    group: 'gate',
    lean: 'bot',
    description: 'The session nonce was older than its allowed lifetime.',
  },
  nonce_replayed: {
    title: 'Replayed session token',
    group: 'gate',
    lean: 'bot',
    description:
      'The nonce was presented from a different TLS client or browser than it was issued to.',
  },
  too_fast: {
    title: 'Manipulated clock',
    group: 'gate',
    lean: 'bot',
    description:
      'The client reported more elapsed time than had really passed since the nonce was issued, a sign of a fast-forwarded clock.',
  },
  automation_markers: {
    title: 'Automation framework detected',
    group: 'gate',
    lean: 'bot',
    description: 'Globals or properties left behind by an automation framework were found.',
  },
  ua_bot: {
    title: 'Declared bot or headless browser',
    group: 'gate',
    lean: 'bot',
    description:
      'The user agent openly identifies itself as a bot, crawler, HTTP library or headless browser.',
  },

  // Environment: what the browser says about itself, and whether that story is consistent.
  webdriver: {
    title: 'Browser under automation',
    group: 'environment',
    lean: 'bot',
    description: 'navigator.webdriver is true.',
  },
  headless_markers: {
    title: 'Headless browser traits',
    group: 'environment',
    lean: 'bot',
    description: 'Traits typical of a headless browser were found.',
  },
  software_renderer: {
    title: 'Software graphics',
    group: 'environment',
    lean: 'bot',
    description:
      'Graphics are rendered in software: typical of servers and headless browsers, but also of remote desktops and virtual machines.',
  },
  ua_client_hints_mismatch: {
    title: 'Inconsistent user agent',
    group: 'environment',
    lean: 'bot',
    description: 'The user-agent string disagrees with the browser’s User-Agent Client Hints.',
  },
  worker_mismatch: {
    title: 'Spoofed browser properties',
    group: 'environment',
    lean: 'bot',
    description: 'Browser properties differ between the page and a Web Worker, a sign of spoofing.',
  },
  feature_mismatch: {
    title: "Features don't match browser version",
    group: 'environment',
    lean: 'bot',
    description: 'The browser lacks features its claimed version should have.',
  },
  renderer_platform_mismatch: {
    title: "Graphics don't match operating system",
    group: 'environment',
    lean: 'bot',
    description:
      'The graphics stack belongs to a different operating system than the browser claims, for example Linux graphics on a browser claiming to be Windows. Typical of server-hosted bots in disguise.',
  },
  native_tamper: {
    title: 'Browser internals modified',
    group: 'environment',
    lean: 'bot',
    description: 'Built-in browser functions have been overwritten.',
  },
  privacy_browser: {
    title: 'Privacy-hardened browser',
    group: 'environment',
    lean: 'neutral',
    description:
      'A privacy-hardened browser was detected. Consistency penalties are switched off for this session.',
  },

  // Network: evidence from the TLS connection and HTTP headers, read at the edge.
  ja4_non_browser: {
    title: 'Non-browser connection',
    group: 'network',
    lean: 'bot',
    description:
      'The TLS connection offered no application protocol (ALPN) at all, as HTTP libraries do, while the user agent claims to be a browser. A company proxy that re-encrypts traffic can cause this too, so it is weighted evidence rather than a gate.',
  },
  ua_ja4_mismatch: {
    title: "Connection doesn't match browser",
    group: 'network',
    lean: 'bot',
    description: 'The TLS fingerprint does not match the browser family in the user agent.',
  },
  sec_fetch_missing: {
    title: 'Missing browser headers',
    group: 'network',
    lean: 'bot',
    description:
      'Fetch metadata headers (Sec-Fetch-*) that this browser always sends were missing.',
  },
  timezone_mismatch: {
    title: 'Time zone mismatch',
    group: 'network',
    lean: 'bot',
    description:
      'The browser’s time zone differs from the time zone of its IP address. VPN users also trigger this, so it is weighted lightly.',
  },
  verified_agent_signature: {
    title: 'Verified agent signature',
    group: 'network',
    lean: 'neutral',
    description: 'The request carried a valid Web Bot Auth signature from a declared agent.',
  },

  // Behaviour: how the person (or program) interacted with the page.
  synthetic_events: {
    title: 'Scripted input events',
    group: 'behaviour',
    lean: 'bot',
    description: 'Input events were generated by script (isTrusted was false).',
  },
  pointer_linear: {
    title: 'Robotic mouse movement',
    group: 'behaviour',
    lean: 'bot',
    description: 'Pointer movement followed unnaturally straight lines at constant speed.',
  },
  pointer_teleport: {
    title: 'Clicks without mouse movement',
    group: 'behaviour',
    lean: 'bot',
    description: 'Clicks happened with no pointer movement leading up to them.',
  },
  click_dead_center: {
    title: 'Clicks exactly centred',
    group: 'behaviour',
    lean: 'bot',
    description: 'Clicks landed exactly in the centre of their targets.',
  },
  keyboard_uniform: {
    title: 'Robotic typing rhythm',
    group: 'behaviour',
    lean: 'bot',
    description: 'Key presses were evenly spaced, as a script would type.',
  },
  form_too_fast: {
    title: 'Form submitted too fast',
    group: 'behaviour',
    lean: 'bot',
    description: 'A protected form was submitted faster than a person could fill it in.',
  },
  pointer_natural: {
    title: 'Natural mouse movement',
    group: 'behaviour',
    lean: 'human',
    description: 'Pointer movement had natural curvature, speed changes and pauses.',
  },
  keyboard_natural: {
    title: 'Natural typing',
    group: 'behaviour',
    lean: 'human',
    description: 'Typing rhythm varied in the way human typing does.',
  },
  touch_natural: {
    title: 'Natural touch',
    group: 'behaviour',
    lean: 'human',
    description: 'Touch contact size, pressure and timing varied naturally.',
  },
  scroll_natural: {
    title: 'Natural scrolling',
    group: 'behaviour',
    lean: 'human',
    description: 'Scrolling showed natural acceleration and rhythm.',
  },
  no_interaction: {
    title: 'No interaction yet',
    group: 'behaviour',
    lean: 'neutral',
    description:
      'No interaction yet. This lowers confidence but does not lower the score on its own.',
  },

  // Engine: how the decision was produced.
  no_js: {
    title: 'No JavaScript',
    group: 'engine',
    lean: 'neutral',
    description: 'The client never ran the browser SDK. Only network evidence was available.',
  },
} as const satisfies Record<string, ReasonInfo>;

export type ReasonCode = keyof typeof REASONS;

export const REASON_CODES: readonly ReasonCode[] = Object.keys(REASONS) as ReasonCode[];
