/**
 * Test markers read from the page URL, e.g. `/?truth=human&run=pilot-1`.
 *
 * They record what a session really is (a known human or a known bot) and are copied into each
 * decision record's `context`, so the evaluation tool can compare realHuman's `label` with the truth.
 * They never influence scoring. `?label=` is accepted as an older spelling of `?truth=`.
 */
const SAFE = /^[A-Za-z0-9_.-]{1,64}$/;

export interface TestMarkers {
  truth?: 'human' | 'bot';
  run?: string;
  scenario?: string;
  participant?: string;
}

export function readMarkers(search: string): TestMarkers {
  const params = new URLSearchParams(search);
  const markers: TestMarkers = {};
  const truth = params.get('truth') ?? params.get('label');
  if (truth === 'human' || truth === 'bot') markers.truth = truth;
  for (const key of ['run', 'scenario', 'participant'] as const) {
    const value = params.get(key);
    if (value && SAFE.test(value)) markers[key] = value;
  }
  return markers;
}

export function markersAsContext(markers: TestMarkers): Record<string, string> {
  const context: Record<string, string> = {};
  for (const [key, value] of Object.entries(markers)) if (value) context[key] = value;
  return context;
}
