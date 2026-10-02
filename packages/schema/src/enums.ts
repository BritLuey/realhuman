/**
 * The headline outcome for a session.
 *
 * - `human`: realHuman is at or above the `human` threshold.
 * - `bot`: realHuman is at or below the `bot` threshold.
 * - `verified_agent`: an AI agent or crawler that cryptographically identified itself.
 * - `uncertain`: between the thresholds, or not enough evidence yet.
 */
export const VERDICTS = ['human', 'bot', 'verified_agent', 'uncertain'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** A finer-grained description of what is driving the session. */
export const KINDS = [
  'human',
  'privacy_browser',
  'automation',
  'scraper',
  'ai_agent',
  'verified_agent',
  'no_js',
  'unknown',
] as const;
export type Kind = (typeof KINDS)[number];

/**
 * Which engine produced a decision.
 *
 * - `gate`: a decisive check (for example a filled honeypot) settled it before any engine ran.
 * - `algorithmic-fallback`: Jev was configured but unavailable, so the algorithmic engine answered.
 */
export const ENGINES = ['algorithmic', 'jev', 'algorithmic-fallback', 'gate'] as const;
export type EngineName = (typeof ENGINES)[number];

/** Where results are delivered. Configured on the server only. */
export const DELIVERY_MODES = ['server', 'client', 'both'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** Result fields that may be exposed to the browser. */
export const CLIENT_FIELDS = ['realHuman', 'verdict', 'kind', 'confidence'] as const;
export type ClientField = (typeof CLIENT_FIELDS)[number];

/** Automation frameworks the browser SDK can recognise from leftover globals. */
export const AUTOMATION_MARKERS = [
  'playwright',
  'puppeteer',
  'selenium',
  'webdriverio',
  'phantomjs',
  'nightmare',
  'cdp',
  'other',
] as const;
export type AutomationMarker = (typeof AUTOMATION_MARKERS)[number];

/** Traits typical of headless browsers. */
export const HEADLESS_MARKERS = [
  'ua_headless',
  'zero_outer_size',
  'missing_window_chrome',
  'permissions_inconsistent',
  'no_plugins',
] as const;
export type HeadlessMarker = (typeof HEADLESS_MARKERS)[number];

/** Privacy-hardened browsers, whose deliberate inconsistencies must not count as bot evidence. */
export const PRIVACY_BROWSERS = ['brave', 'firefox_rfp', 'tor', 'safari_atfp', 'other'] as const;
export type PrivacyBrowser = (typeof PRIVACY_BROWSERS)[number];
