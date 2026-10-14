import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { useLabels } from "../preferences/useLabels";
import type { DiscardGuard } from "./discardGuard";
import { handleVaultDialogKey } from "./vaultKeyboard";

function DiscardSheet({ guard, trigger }: { guard: DiscardGuard; trigger: HTMLElement | null }) {
  const { t } = useLabels();
  const sheet = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // The safe action takes focus; focus returns to whatever opened the dialog.
    cancel.current?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, [trigger]);

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const focusable = Array.from(sheet.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
    handleVaultDialogKey(event, false, focusable, document.activeElement, guard.cancel);
  }

  return (
    <div className="vault-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) guard.cancel(); }}>
      <div ref={sheet} className="vault-dialog raised-panel" role="dialog" aria-modal="true"
        aria-labelledby="discard-dialog-title" aria-describedby="discard-dialog-description" onKeyDown={keys}>
        <p className="eyebrow">{t("discardEyebrow")}</p>
        <h2 id="discard-dialog-title">{t("discardTitle")}</h2>
        <p id="discard-dialog-description" className="workspace-intro">{t("discardDescription")}</p>
        <div className="vault-dialog-actions">
          <button ref={cancel} type="button" className="action-button secondary-button" onClick={guard.cancel}>{t("vaultCancel")}</button>
          <button type="button" className="action-button danger-action" onClick={guard.confirm}>{t("discardConfirm")}</button>
        </div>
      </div>
    </div>
  );
}

/** Single app-level host for the discard confirmation requested by the Vault and the history tray. */
export function DiscardDialog({ guard }: { guard: DiscardGuard }) {
  const state = useSyncExternalStore(guard.subscribe, guard.getSnapshot, guard.getSnapshot);
  return state.open ? <DiscardSheet guard={guard} trigger={state.trigger} /> : null;
}
