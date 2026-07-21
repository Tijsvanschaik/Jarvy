import { useEffect, useRef, useState } from "react";
import type { OpsStateEvent } from "../shared/ipc";

export function OperatorPanel() {
  const [state, setState] = useState<OpsStateEvent | null>(null);
  const [block, setBlock] = useState("");
  const blockDirty = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.aiden.getOpsState().then((next) => {
      setState(next);
      setBlock(next.block);
    });
    return window.aiden.onOpsState((next) => {
      setState(next);
      if (!blockDirty.current) setBlock(next.block);
    });
  }, []);

  if (!state) return <main className="operator-shell">Operatorstatus laden…</main>;
  const warnings = [...state.warnings, ...(state.context?.warnings ?? [])];

  return (
    <main className="operator-shell">
      <header>
        <div>
          <span className="operator-kicker">Aiden operations</span>
          <h1>{state.session.state}</h1>
        </div>
        <button
          className="hard-close"
          disabled={busy || !state.session.active}
          onClick={async () => {
            setBusy(true);
            try {
              setState(await window.aiden.hardCloseSession({ reason: "operator" }));
            } finally {
              setBusy(false);
            }
          }}
        >
          Hard close session
        </button>
      </header>

      <section className="operator-metrics">
        <Metric label="Mic level" value={`${Math.round(state.capture.level * 100)}%`} />
        <Metric label="Capture" value={state.capture.capture} />
        <Metric label="VAD" value={state.capture.vadSpeech ? "speech" : "quiet"} />
        <Metric label="Queue" value={`${state.queue.depth} / ${state.queue.active} active`} />
        <Metric label="Oldest pending" value={formatAge(state.queue.oldestPendingTs)} />
        <Metric label="Duration" value={formatDuration(state.session.durationMs)} />
        <Metric label="Inactivity" value={formatDuration(state.session.inactivityRemainingMs)} />
        <Metric label="Notes" value={String(state.notesCount)} />
      </section>

      <section className="operator-block">
        <label htmlFor="operator-block">Current block</label>
        <div>
          <input id="operator-block" value={block} onChange={(event) => { setBlock(event.target.value); blockDirty.current = true; }} />
          <button
            disabled={busy || !block.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                setState(await window.aiden.setOpsBlock({ block }));
                blockDirty.current = false;
              } finally {
                setBusy(false);
              }
            }}
          >
            Set block
          </button>
        </div>
      </section>

      <div className="operator-columns">
        <section>
          <h2>Latest transcript</h2>
          <div className="operator-list">
            {[...state.transcript].reverse().map((entry) => (
              <article key={entry.id}>
                <small>{entry.source} · {new Date(entry.tsStart).toLocaleTimeString()}</small>
                <p>{entry.text}</p>
              </article>
            ))}
            {!state.transcript.length ? <p className="muted">No transcript yet.</p> : null}
          </div>
        </section>

        <section>
          <h2>Context budget</h2>
          <div className="operator-list">
            {state.context?.sections.map((section) => (
              <article key={section.id}>
                <strong>{section.id}</strong>
                <p>{section.tokens} / {section.budget} tokens{section.truncated ? " · truncated" : ""}</p>
              </article>
            )) ?? <p className="muted">Available after activation.</p>}
          </div>
          <h2>Warnings</h2>
          <ul className="operator-warnings">
            {state.queue.lastError ? <li>{state.queue.lastError}</li> : null}
            {state.capture.error ? <li>{state.capture.error}</li> : null}
            {warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
            {!state.queue.lastError && !state.capture.error && !warnings.length ? <li className="muted">None</li> : null}
          </ul>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

export function formatDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined) return "—";
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatAge(timestamp: number | undefined, now = Date.now()): string {
  if (timestamp === undefined) return "—";
  return formatDuration(now - timestamp);
}
