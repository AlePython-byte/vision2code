import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Braces, Copy, X } from "lucide-react";
import type { UISchema } from "@vision2code/contracts";
import type { GenerationSessionModel } from "../generation/generationSessionModel";
import { handleVaultDialogKey } from "../projects/vaultKeyboard";
import { computeSchemaMetrics, metricRows } from "./schemaMetrics";
import "./schemaInspector.css";

// Development tool: English only, outside resources.ts. It is reached only through a dynamic import
// behind `import.meta.env.DEV` (see App.tsx) so production builds do not contain it.
// Marker checked by the build verification: "Schema inspector (development only)".
const TITLE = "Schema inspector (development only)";

type CopyState = "idle" | "json" | "metrics" | "failed";

/** "Schema" action plus a read-only dialog with the current result's UISchema and its metrics. */
export default function SchemaInspector({ session }: { session: GenerationSessionModel }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const uiSchema = state.artifact?.uiSchema ?? null;
  return (
    <>
      <button ref={trigger} type="button" className="action-button" disabled={uiSchema === null} aria-haspopup="dialog"
        title={uiSchema === null ? "No result yet: generate or open a generation first." : "Inspect the UISchema of the current result (development only)"}
        onClick={() => setOpen(true)}>
        <Braces aria-hidden="true" />Schema
      </button>
      {open && uiSchema !== null && (
        <InspectorSheet uiSchema={uiSchema} origin={state.origin} trigger={trigger} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

export function InspectorSheet({ uiSchema, origin, trigger, onClose }: {
  uiSchema: UISchema;
  origin: "GENERATED" | "RESTORED" | null;
  trigger: { readonly current: HTMLButtonElement | null };
  onClose: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState<CopyState>("idle");
  const metrics = computeSchemaMetrics(uiSchema);
  const rows = metricRows(metrics);

  useEffect(() => {
    closeButton.current?.focus();
    return () => { if (trigger.current?.isConnected) trigger.current.focus(); };
  }, [trigger]);

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const focusable = Array.from(sheet.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
    handleVaultDialogKey(event, false, focusable, document.activeElement, onClose);
  }
  async function copy(kind: "json" | "metrics") {
    const text = kind === "json" ? JSON.stringify(uiSchema, null, 2) : JSON.stringify(metrics, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="vault-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={sheet} className="vault-dialog schema-inspector raised-panel" role="dialog" aria-modal="true"
        aria-labelledby="schema-inspector-title" onKeyDown={keys}>
        <header className="schema-inspector-header">
          <div>
            <p className="eyebrow">Development only · {origin === "RESTORED" ? "restored generation" : "current result"}</p>
            <h2 id="schema-inspector-title">{TITLE}</h2>
          </div>
          <button ref={closeButton} type="button" className="action-button secondary-button schema-inspector-close"
            aria-label="Close schema inspector" onClick={onClose}><X aria-hidden="true" /></button>
        </header>

        <section aria-labelledby="schema-metrics-title">
          <h3 id="schema-metrics-title" className="eyebrow">Metrics</h3>
          <table className="schema-metrics">
            <tbody>
              {rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="schema-warnings-title">
          <h3 id="schema-warnings-title" className="eyebrow">Warnings ({uiSchema.warnings.length})</h3>
          {uiSchema.warnings.length === 0
            ? <p className="schema-inspector-note">The model reported no warnings.</p>
            : <ul className="schema-warnings">{uiSchema.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        </section>

        <section aria-labelledby="schema-json-title">
          <h3 id="schema-json-title" className="eyebrow">UISchema JSON (read-only)</h3>
          <button type="button" className="action-button secondary-button" aria-expanded={showJson} aria-controls="schema-json"
            onClick={() => setShowJson((value) => !value)}>{showJson ? "Hide JSON" : "Show JSON"}</button>
          {showJson && <pre id="schema-json" className="schema-json" tabIndex={0}>{JSON.stringify(uiSchema, null, 2)}</pre>}
        </section>

        <div className="vault-dialog-actions">
          <button type="button" className="action-button secondary-button" onClick={() => { void copy("metrics"); }}>
            <Copy aria-hidden="true" />Copy metrics
          </button>
          <button type="button" className="action-button secondary-button" onClick={() => { void copy("json"); }}>
            <Copy aria-hidden="true" />Copy JSON
          </button>
        </div>
        <p className="schema-inspector-note" role="status" aria-live="polite">
          {copied === "json" ? "UISchema JSON copied." : copied === "metrics" ? "Metrics copied." : copied === "failed" ? "Could not copy to the clipboard." : ""}
        </p>
      </div>
    </div>
  );
}
