/**
 * The questions realHuman asks Jev. Any change to wording or options must bump
 * `QUESTIONS_VERSION`, because it changes what the probabilities mean. Each decision record
 * carries the version, so scores from different wordings can be told apart.
 */
export const QUESTIONS_VERSION = '1';

export interface JevBooleanQuestion {
  readonly type: 'boolean';
  readonly instructions: string;
  readonly criteria?: { readonly true: string; readonly false: string };
}

export interface JevChoiceQuestion {
  readonly type: 'choice';
  readonly instructions: string;
  /** Option name → description. */
  readonly criteria: Readonly<Record<string, string>>;
}

export type JevQuestion = JevBooleanQuestion | JevChoiceQuestion;

/** Options for the `kind` question. Every one is also a realHuman `Kind`. */
export const KIND_OPTIONS = [
  'human',
  'privacy_browser',
  'automation',
  'scraper',
  'ai_agent',
] as const;
export type KindOption = (typeof KIND_OPTIONS)[number];

export const QUESTIONS = {
  human: {
    type: 'boolean',
    instructions: 'Is this browser session operated by a real human?',
    criteria: {
      true: 'organic human interaction in a real browser (including privacy-hardened browsers)',
      false: 'automation, scripted, headless, or agent-driven',
    },
  },
  kind: {
    type: 'choice',
    instructions: 'What is driving this session?',
    criteria: {
      human: 'a person using an ordinary browser',
      privacy_browser:
        'a person using a privacy-hardened browser (Brave, Tor, Firefox resistFingerprinting) whose inconsistencies are deliberate',
      automation: 'a browser automation framework such as Playwright, Puppeteer or Selenium',
      scraper: 'a headless browser or HTTP client collecting pages',
      ai_agent: 'an AI agent operating a browser on behalf of a user',
    } satisfies Record<KindOption, string>,
  },
} as const satisfies Record<string, JevQuestion>;
