import type { ServerFacts } from '@realhuman/schema';
import { isChromium, parseUserAgent } from './ua.js';

/**
 * Network evidence supplied by an adapter. `ja4` and `ipTimezone` must come from headers set by a
 * trusted CDN or proxy, never from anything the client controls.
 */
export interface TrustedFacts {
  readonly ja4: string | null;
  readonly ipTimezone: string | null;
}

/** Turns request headers plus trusted CDN facts into the privacy-reduced facts stored in records. */
export function deriveServerFacts(
  headers: Headers,
  trusted: TrustedFacts,
  clientTimezone: string | null,
  verifiedAgent: string | null,
): ServerFacts {
  const ua = parseUserAgent(headers.get('user-agent'));
  const secChUa = headers.get('sec-ch-ua');
  const ja4 = trusted.ja4?.trim().slice(0, 64) || null;

  return {
    ja4,
    uaFamily: ua.family,
    uaMajor: ua.major,
    platform: ua.platform,
    timezoneMatch: timezonesMatch(clientTimezone, trusted.ipTimezone),
    secFetchPresent: headers.has('sec-fetch-site') && headers.has('sec-fetch-mode'),
    clientHintsPresent: secChUa !== null,
    clientHintsMismatch:
      secChUa === null
        ? null
        : clientHintsContradict(
            secChUa,
            headers.get('sec-ch-ua-platform'),
            ua.family,
            ua.major,
            ua.platform,
          ),
    verifiedAgent,
  };
}

interface Brand {
  readonly brand: string;
  readonly version: number | null;
}

/** Parses `"Chromium";v="141", "Not?A_Brand";v="8", "Google Chrome";v="141"`. */
export function parseBrands(header: string): Brand[] {
  const brands: Brand[] = [];
  for (const match of header.matchAll(/"([^"]*)"\s*;\s*v\s*=\s*"([^"]*)"/g)) {
    const version = Number.parseInt(match[2] ?? '', 10);
    brands.push({ brand: match[1] ?? '', version: Number.isFinite(version) ? version : null });
  }
  return brands;
}

const PLATFORM_NAMES: Record<string, string> = {
  windows: 'windows',
  macos: 'macos',
  'mac os x': 'macos',
  android: 'android',
  ios: 'ios',
  linux: 'linux',
  'chrome os': 'chromeos',
  chromeos: 'chromeos',
};

function clientHintsContradict(
  secChUa: string,
  secChUaPlatform: string | null,
  family: string | null,
  major: number | null,
  platform: string | null,
): boolean {
  // Firefox and Safari never send Client Hints.
  if (family === 'firefox' || family === 'safari') return true;
  if (!isChromium(family)) return false;

  const brands = parseBrands(secChUa);
  if (brands.length === 0) return true;
  const chromium = brands.find((b) => b.brand === 'Chromium');
  // Some embedded Chromium builds omit the "Chromium" brand, so only compare when it's present.
  if (
    chromium?.version != null &&
    major !== null &&
    family === 'chrome' &&
    chromium.version !== major
  ) {
    return true;
  }

  if (secChUaPlatform && platform && platform !== 'other') {
    const hinted = PLATFORM_NAMES[secChUaPlatform.replace(/"/g, '').trim().toLowerCase()];
    if (hinted && hinted !== platform) return true;
  }
  return false;
}

/** Compares the current UTC offset of two IANA time zones. null if either is unknown or invalid. */
export function timezonesMatch(
  a: string | null,
  b: string | null,
  at: Date = new Date(),
): boolean | null {
  if (!a || !b) return null;
  if (a === b) return true;
  const offsetA = utcOffset(a, at);
  const offsetB = utcOffset(b, at);
  if (offsetA === null || offsetB === null) return null;
  return offsetA === offsetB;
}

const offsetCache = new Map<string, Intl.DateTimeFormat | null>();

function utcOffset(timeZone: string, at: Date): string | null {
  let format = offsetCache.get(timeZone);
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    } catch {
      format = null;
    }
    if (offsetCache.size > 500) offsetCache.clear();
    offsetCache.set(timeZone, format);
  }
  if (!format) return null;
  return format.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? null;
}
