# Privacy & compliance

This page is for privacy, legal and data-protection teams. It describes what realHuman processes and how
it's designed to minimise privacy impact.

> [!WARNING]
> **This is not legal advice.** Whether and how you may use realHuman depends on your jurisdiction, your
> purposes and your other processing. Have your data protection officer or counsel review your setup,
> especially the [consent question](#consent-and-the-eprivacy-directive) below.

## Summary

| Question | Answer |
|---|---|
| Does it store anything on the visitor's device? | **No.** No cookies, localStorage, sessionStorage or IndexedDB. |
| Does it create an identifier that persists between visits? | **No.** The `sid` is random per page load and is never stored on the device. |
| Does it read IP addresses? | **No.** realHuman reads only the IP's time zone, which your CDN provides as a separate header. |
| Does it read what people type? | **No.** Only timing and key *class* (character, editing, navigation, modifier). |
| Does it record mouse positions? | **No.** Positions are used in the browser to compute statistics, then discarded. |
| Does it fingerprint devices (canvas, audio, fonts, GPU)? | **No.** Device details are reduced to yes/no answers. |
| Does data leave your infrastructure? | **Only with the [Jev engine](#jev-engine)**, which sends signal summaries to your chosen AI provider. |
| Who is the controller of the data? | **You.** realHuman is software you run; we receive nothing. |

## What is processed

| Data | Where | Kept in the decision record? |
|---|---|---|
| Signal summaries ([full list](../reference/signals.md)) | Browser → your server | Yes (`signals`) |
| JA4 TLS fingerprint | Your CDN → your server | Yes (`server.ja4`). Shared by everyone using the same browser build, so it doesn't single anyone out. |
| User agent | Your CDN → your server | Only browser family, major version and platform |
| IP time zone | Your CDN → your server | Only whether it matches the browser's time zone (`server.timezoneMatch`) |
| Browser time zone | Browser → your server | Yes (`signals.env.timezone`) |
| Your join keys (`context`) | Browser → your server | Yes. **You choose these**, for example an analytics client id. |
| Web Bot Auth agent name | Request header → your server | Yes (`server.verifiedAgent`); identifies software agents, not people |

## Is a decision record personal data?

On its own a record contains no direct identifiers, and realHuman is designed so that records are hard to
link to a person. However:

- if you put an analytics id in `context`, the record becomes linkable to your analytics data, and you
  should treat it as personal data in the same way;
- under GDPR, data is personal if it can be linked to a person **by any means reasonably likely to be
  used**, which your analytics joins may provide.

**Safest assumption:** treat decision records like the analytics data you join them to.

## Consent and the ePrivacy Directive

Article 5(3) of the EU ePrivacy Directive (and the UK's PECR) covers *gaining access to information
stored in* a user's device, not just cookies. The European Data Protection Board's guidelines read this
broadly, and reading device characteristics in JavaScript may fall within it.

There is an exemption for access that is **strictly necessary** for a service the user requested. Blocking
fraud or attacks is sometimes argued to qualify. realHuman, however, is used to **improve analytics
quality**, which is unlikely to count as strictly necessary.

**Recommended default:** load realHuman under the **same consent as your analytics**:

```ts
const rh = init({ consent: false });
cmp.onAnalyticsConsent(() => rh.grantConsent());
```

In practice you lose very little: if your analytics only run after consent, there's no non-consented
analytics data to clean.

Before `grantConsent()` the SDK collects nothing, adds no listeners, makes no requests and injects no
honeypots.

## Jev engine

With `engine: jev(…)` (or Jev as a `shadow` engine), signal summaries, network consistency results and
JA4 parts are sent to:

- **TypeSafe AI**, which operates Jev, and
- **Vercel** (if using AI Gateway) or **OpenRouter** (if using OpenRouter), which sit in between.

**Not sent:** IP addresses, raw user agents, your `context` join keys, or any content.

Before enabling Jev:

- [ ] Add the providers to your record of processing and subprocessor list
- [ ] Check each provider's data processing agreement and data-transfer terms
- [ ] Keep `zeroDataRetention: true` (the default), which asks Vercel AI Gateway to route only to providers that don't retain request data
- [ ] Update your privacy notice if it lists the processors you use

## Retention

realHuman stores nothing itself; you decide where records go. We recommend:

- the **same retention as the analytics data** you join records to, and
- if you only need aggregates, keep detailed records (with `signals`) for a short period (for example 90 days)
  and aggregated bot-share figures longer.

## DPIA checklist

Points to cover in a Data Protection Impact Assessment:

- [ ] **Purpose:** improving analytics accuracy by excluding automated traffic
- [ ] **Legal basis** for the processing (often legitimate interests, or consent together with analytics)
- [ ] **Device access** under ePrivacy / PECR (see [above](#consent-and-the-eprivacy-directive))
- [ ] **Data minimisation:** summaries only, no content, no storage, no persistent ids (this page)
- [ ] **Join keys** placed in `context`, and what they link to
- [ ] **Recipients:** your pipeline; plus Jev providers if enabled
- [ ] **International transfers:** where your hosting and Jev providers process data
- [ ] **Retention** periods for decision records
- [ ] **Automated decision-making:** realHuman labels analytics data and doesn't make decisions with legal or similarly significant effects on individuals. Re-assess if you start using scores for anything else, such as blocking or pricing.

## Accessibility

The honeypots are hidden from screen readers and keyboard navigation (`inert`, `aria-hidden`,
`tabindex="-1"`), so they don't affect people who use assistive technology. Because realHuman never blocks,
people whose interaction looks unusual, for example switch-access users, are never locked out. At worst
their sessions are labelled `uncertain`.

## Third-party licences

The JA4 TLS client fingerprint method is published by FoxIO under the BSD 3-Clause licence. realHuman only
uses JA4 values computed by your CDN. It does not implement or bundle the separately licensed JA4+ methods
(JA4H, JA4S, JA4X and others).
