/**
 * Evaluation labels read from the page URL, e.g. `/?label=human&run=pilot-1`.
 *
 * They're copied into each decision record's `context` so the evaluation tool can compare scores
 * for known humans and known bots. They never influence scoring.
 */
const SAFE = /^[A-Za-z0-9_.-]{1,64}$/;

export interface Labels {
  label?: 'human' | 'bot';
  run?: string;
  scenario?: string;
  participant?: string;
}

export function readLabels(search: string): Labels {
  const params = new URLSearchParams(search);
  const labels: Labels = {};
  const label = params.get('label');
  if (label === 'human' || label === 'bot') labels.label = label;
  for (const key of ['run', 'scenario', 'participant'] as const) {
    const value = params.get(key);
    if (value && SAFE.test(value)) labels[key] = value;
  }
  return labels;
}

export function labelsAsContext(labels: Labels): Record<string, string> {
  const context: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) if (value) context[key] = value;
  return context;
}
