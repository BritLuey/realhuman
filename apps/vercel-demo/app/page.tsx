'use client';

import { useRealHuman } from '@realhuman/react';
import { REASONS, type ReasonCode } from '@realhuman/schema';
import type { DecisionRecord } from '@realhuman/vercel';
import { type FormEvent, useEffect, useState } from 'react';
import { type Labels, readLabels } from './labels';

type Why =
  | { state: 'idle' | 'loading' | 'unavailable' }
  | { state: 'ready'; record: DecisionRecord };

export default function Page() {
  const { instance, result } = useRealHuman();
  const [labels, setLabels] = useState<Labels>({});
  const [why, setWhy] = useState<Why>({ state: 'idle' });
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => setLabels(readLabels(window.location.search)), []);

  // Exposed for debugging and for the bot lab, which drives this page in test runs.
  useEffect(() => {
    (window as unknown as { realHuman?: unknown }).realHuman = instance ?? undefined;
  }, [instance]);

  // After each result, fetch the server-side record (with reason codes) for this session.
  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    setWhy((current) => (current.state === 'ready' ? current : { state: 'loading' }));
    const load = async (attempt: number): Promise<void> => {
      const response = await fetch(`/api/decisions?sid=${encodeURIComponent(result.sid)}`, {
        cache: 'no-store',
      });
      if (cancelled) return;
      if (response.status === 501) return setWhy({ state: 'unavailable' });
      if (response.ok) {
        const record = (await response.json()) as DecisionRecord;
        if (record.seq >= result.seq || attempt >= 5) return setWhy({ state: 'ready', record });
      }
      if (attempt < 5) setTimeout(() => void load(attempt + 1), 400);
    };
    void load(0);
    return () => {
      cancelled = true;
    };
  }, [result]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await instance?.score();
    setSubmitted(true);
  };

  return (
    <main>
      <header>
        <h1>realHuman demo</h1>
        <p className="lead">
          This page scores your visit from 0 (bot) to 1 (human) using how you interact and how your
          browser connects. It never blocks anyone, and it stores nothing on your device.
        </p>
      </header>

      {labels.label === 'human' && (
        <section className="callout" aria-label="Test instructions">
          <strong>Thanks for helping test realHuman.</strong> Please use this page the way you
          normally would for about 30 seconds: read it, scroll, and fill in the form below. Then you
          can close the tab. Nothing you type is recorded, only timing patterns.
        </section>
      )}
      {labels.label === 'bot' && (
        <section className="callout muted" aria-label="Test run">
          Automated test run{labels.scenario ? `: ${labels.scenario}` : ''}.
        </section>
      )}

      <section aria-live="polite" className="score-card">
        <div className="muted">Your score</div>
        <div className="score-row">
          <span className="score">
            {result?.realHuman !== undefined ? result.realHuman.toFixed(2) : '…'}
          </span>
          <span className={`pill ${result?.verdict ?? ''}`}>{result?.verdict ?? 'measuring'}</span>
          {result?.confidence !== undefined && (
            <span className="pill">confidence {result.confidence.toFixed(2)}</span>
          )}
        </div>
        <div className="muted small">
          {result
            ? `update #${result.seq} · session ${result.sid.slice(0, 8)}…`
            : 'The first update arrives about a second after the page loads.'}
        </div>
      </section>

      <section>
        <h2>Try the form</h2>
        <form id="signup" data-realhuman onSubmit={onSubmit}>
          <label htmlFor="name">Name</label>
          <input id="name" name="name" autoComplete="name" />
          <label htmlFor="message">Message</label>
          <textarea id="message" name="message" rows={3} />
          <div className="buttons">
            <button type="submit">Submit</button>
            <button
              id="score-now"
              type="button"
              className="secondary"
              onClick={() => void instance?.score()}
            >
              Score now
            </button>
          </div>
          {submitted && <p className="muted small">Scored. Nothing was sent anywhere else.</p>}
        </form>
      </section>

      <section>
        <h2>Why this score?</h2>
        {why.state === 'idle' && <p className="muted">Waiting for the first update…</p>}
        {why.state === 'loading' && <p className="muted">Loading the server-side record…</p>}
        {why.state === 'unavailable' && (
          <p className="muted">
            Connect an Upstash Redis database to this deployment to see reason codes here. They are
            always in the function logs.
          </p>
        )}
        {why.state === 'ready' && <Reasons record={why.record} />}
      </section>

      <section className="muted small">
        <h2>What's collected</h2>
        <p>
          Summaries only: how pointer movement curves and varies, typing rhythm (never which keys),
          scrolling rhythm, and whether the browser is being automated. No cookies, no storage, no
          IP addresses, no fingerprints. Read{' '}
          <a href="https://github.com/your-org/realhuman">how realHuman works</a>.
        </p>
      </section>
      <div className="spacer" aria-hidden="true" />
    </main>
  );
}

function Reasons({ record }: { record: DecisionRecord }) {
  return (
    <>
      <p className="small muted">
        Engine <code>{record.engine}</code> · kind <code>{record.kind}</code> · TLS fingerprint{' '}
        <code>{record.server.ja4 ?? 'not available'}</code>
      </p>
      {record.reasons.length === 0 ? (
        <p className="muted">No notable evidence either way yet.</p>
      ) : (
        <ul className="reasons">
          {record.reasons.map((code) => {
            const info = REASONS[code as ReasonCode];
            return (
              <li key={code} className={info?.lean ?? 'neutral'}>
                <code>{code}</code> {info?.description}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
