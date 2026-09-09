/**
 * Ask: point and route questions.
 *
 * Every answer shows which hotspots it reasoned over and at what provenance
 * tier, so the verdict is auditable rather than a black box.
 *
 * Answers are computed on the device from the same scoring the map uses.
 * The deployed backend never had model credentials, so it always ran this
 * same deterministic path; making that explicit costs nothing and removes
 * the round trip.
 */

import { useEffect, useRef, useState } from 'react';

import { ask } from '../lib/store';
import type { Snapshot } from '../lib/store';
import { BAND, CONFIDENCE, renderEmphasis } from '../lib/display';
import type { ChatResponse } from '../types';

interface Turn {
  id: number;
  role: 'you' | 'app';
  text: string;
  answer?: ChatResponse;
}

const STARTERS = [
  'Is Iffco Chowk risky right now?',
  'Sector 49 to Cyber City in the next hour?',
  'How is Hero Honda Chowk looking this evening?',
  'Golf Course Road to MG Road — safe to drive?',
];

export default function AskPanel({ snapshot }: { snapshot: Snapshot | null }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const id = Date.now();
    setTurns((t) => [...t, { id, role: 'you', text: question }]);
    setDraft('');
    setBusy(true);

    try {
      if (!snapshot) {
        throw new Error('The rainfall forecast is still loading. Try again in a moment.');
      }
      // Resolving a place can touch the network (Nominatim), so this is
      // awaited rather than assumed instant.
      const answer = await ask(question, snapshot);
      setTurns((t) => [...t, { id: id + 1, role: 'app', text: answer.verdict, answer }]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not work out an answer for that.';
      setTurns((t) => [...t, { id: id + 1, role: 'app', text: message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask">
      <div className="ask-log" ref={logRef}>
        {turns.length === 0 && (
          <div className="empty" style={{ paddingTop: 32 }}>
            <b>Ask about a place or a route</b>
            Answers always state a time window, name the hotspots they reasoned over, and
            show how confident the underlying data is.
          </div>
        )}

        {turns.map((turn) =>
          turn.role === 'you' ? (
            <div key={turn.id} className="msg msg-you">
              <div className="msg-body">{turn.text}</div>
            </div>
          ) : (
            <Answer key={turn.id} turn={turn} />
          ),
        )}

        {busy && (
          <div className="msg msg-app">
            <div className="msg-body" style={{ color: 'var(--ink-faint)' }}>
              Scoring the register against the forecast…
            </div>
          </div>
        )}
      </div>

      {turns.length === 0 && (
        <div className="prompts">
          {STARTERS.map((s) => (
            <button key={s} className="prompt" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          className="ask-input"
          rows={1}
          value={draft}
          placeholder="Ask about a chowk, sector or route…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          aria-label="Your question"
        />
        <button className="btn" type="submit" disabled={busy || !draft.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}

function Answer({ turn }: { turn: Turn }) {
  const a = turn.answer;
  const level = a?.route_analysis?.overall_risk_level ?? a?.hotspots_referenced[0]?.risk_level ?? 'low';

  return (
    <div className="msg msg-app" style={{ ['--band' as string]: BAND[level] }}>
      <div
        className="msg-body"
        // The verdict templates emit only **bold**; renderEmphasis
        // converts exactly that and nothing else.
        dangerouslySetInnerHTML={{
          __html: renderEmphasis(turn.text)
            .split('\n\n')
            .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
            .join(''),
        }}
      />

      {a && (
        <div className="msg-meta">
          <span className="chip">Rule-based, computed on your device</span>
          {a.route_analysis && (
            <span className="chip">
              straight-line corridor · {a.route_analysis.hotspot_count} points ·{' '}
              {a.route_analysis.total_distance_km} km
            </span>
          )}
          {a.hotspots_referenced.slice(0, 3).map((h) => (
            <span key={h.name} title={CONFIDENCE[h.data_confidence]?.blurb}>
              {h.name} ({CONFIDENCE[h.data_confidence]?.short ?? h.data_confidence})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
