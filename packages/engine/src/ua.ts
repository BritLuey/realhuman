/**
 * A deliberately small user-agent parser. It only extracts what the engine
 * needs (browser family, major version, platform, headless and declared bots)
 * and keeps nothing else, so the raw string never reaches a decision record.
 */

export type BrowserFamily =
  | 'chrome'
  | 'edge'
  | 'opera'
  | 'samsung'
  | 'firefox'
  | 'safari'
  | 'bot'
  | 'other';

export type Platform = 'windows' | 'macos' | 'ios' | 'android' | 'linux' | 'chromeos' | 'other';

export interface ParsedUserAgent {
  readonly family: BrowserFamily | null;
  readonly major: number | null;
  readonly platform: Platform | null;
  /** UA contains "HeadlessChrome" or similar. */
  readonly headless: boolean;
  /** UA openly identifies as a bot, crawler or HTTP library. */
  readonly declaredBot: boolean;
}

const BOT_PATTERN =
  /\bbot\b|bot\/|crawler|spider|crawling|slurp|facebookexternalhit|curl\/|wget\/|python-requests|python-urllib|python\/|aiohttp|httpx|go-http-client|okhttp|java\/|apache-httpclient|axios\/|node-fetch|undici|got \(|libwww|scrapy|phantomjs|postmanruntime|insomnia/i;

const BROWSER_FAMILIES: ReadonlySet<BrowserFamily> = new Set([
  'chrome',
  'edge',
  'opera',
  'samsung',
  'firefox',
  'safari',
]);

export function isBrowserFamily(family: BrowserFamily | string | null): boolean {
  return family !== null && BROWSER_FAMILIES.has(family as BrowserFamily);
}

export function isChromium(family: BrowserFamily | string | null): boolean {
  return family === 'chrome' || family === 'edge' || family === 'opera' || family === 'samsung';
}

function major(ua: string, pattern: RegExp): number | null {
  const match = ua.match(pattern);
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

export function parseUserAgent(ua: string | null): ParsedUserAgent {
  if (!ua)
    return { family: null, major: null, platform: null, headless: false, declaredBot: false };

  const headless = /headless/i.test(ua);
  const declaredBot = BOT_PATTERN.test(ua);

  let family: BrowserFamily = 'other';
  let version: number | null = null;
  if (declaredBot) {
    family = 'bot';
  } else if (/Edg(e|A|iOS)?\//.test(ua)) {
    family = 'edge';
    version = major(ua, /Edg(?:e|A|iOS)?\/(\d+)/);
  } else if (/OPR\/|Opera/.test(ua)) {
    family = 'opera';
    version = major(ua, /OPR\/(\d+)/);
  } else if (/SamsungBrowser\//.test(ua)) {
    family = 'samsung';
    version = major(ua, /SamsungBrowser\/(\d+)/);
  } else if (/(Headless)?Chrome\/|CriOS\//.test(ua)) {
    family = 'chrome';
    version = major(ua, /(?:Chrome|CriOS)\/(\d+)/);
  } else if (/Firefox\/|FxiOS\//.test(ua)) {
    family = 'firefox';
    version = major(ua, /(?:Firefox|FxiOS)\/(\d+)/);
  } else if (/Safari\//.test(ua) && /Version\//.test(ua)) {
    family = 'safari';
    version = major(ua, /Version\/(\d+)/);
  }

  let platform: Platform = 'other';
  if (/iPhone|iPad|iPod/.test(ua)) platform = 'ios';
  else if (/Android/.test(ua)) platform = 'android';
  else if (/Windows NT/.test(ua)) platform = 'windows';
  else if (/CrOS/.test(ua)) platform = 'chromeos';
  else if (/Mac OS X|Macintosh/.test(ua)) platform = 'macos';
  else if (/Linux|X11/.test(ua)) platform = 'linux';

  return { family, major: version, platform, headless, declaredBot };
}

/**
 * Whether this browser version always sends Fetch Metadata (Sec-Fetch-*) headers.
 * Chrome/Edge 80+, Firefox 90+, Safari 16.4+ (we require 17 to be safe).
 */
export function expectsFetchMetadata(family: string | null, version: number | null): boolean {
  if (version === null) return false;
  if (isChromium(family)) return family === 'samsung' ? version >= 13 : version >= 80;
  if (family === 'firefox') return version >= 90;
  if (family === 'safari') return version >= 17;
  return false;
}
