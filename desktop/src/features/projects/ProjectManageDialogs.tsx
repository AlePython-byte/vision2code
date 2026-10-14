import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { useLabels } from "../preferences/useLabels";
import type { ProjectManageDialog as DialogState, ProjectManager } from "./projectManageActions";
import { PROJECT_NAME_MAX_LENGTH, validateProjectName, type ProjectNameError } from "./projectTargetActions";
import { handleVaultDialogKey } from "./vaultKeyboard";

type SheetProps = { manager: ProjectManager; dialog: DialogState };

/** Focus goes back to the opener; a deleted card's button is gone, so the Vault region takes it instead. */
function restoreFocus(trigger: HTMLElement | null) {
  if (trigger?.isConnected) trigger.focus();
  else document.getElementById?.("project-vault")?.focus();
}

function trapKeys(sheet: { readonly current: HTMLDivElement | null }, pending: boolean, close: () => void) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    const focusable = Array.from(sheet.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)") ?? []);
    handleVaultDialogKey(event, pending, focusable, document.activeElement, close);
  };
}

export function RenameProjectDialog({ manager, dialog }: SheetProps) {
  const { t } = useLabels();
  const sheet = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(dialog.name);
  const [nameError, setNameError] = useState<ProjectNameError | null>(null);
  const pending = dialog.status === "PENDING";
  const failed = dialog.status === "ERROR";

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
    return () => restoreFocus(dialog.trigger);
  }, [dialog.trigger]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const validation = validateProjectName(name);
    if (!validation.ok) { setNameError(validation.error); return; }
    setNameError(null);
    void manager.confirmRename(validation.name);
  }

  return (
    <div className="vault-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) manager.cancel(); }}>
      <div ref={sheet} className="vault-dialog raised-panel" role="dialog" aria-modal="true" aria-labelledby="rename-dialog-title"
        aria-describedby="rename-dialog-description" aria-busy={pending || undefined} onKeyDown={trapKeys(sheet, pending, manager.cancel)}>
        <p className="eyebrow">{t("renameEyebrow")}</p>
        <h2 id="rename-dialog-title">{t("renameTitle")}</h2>
        <p id="rename-dialog-description" className="workspace-intro">{t("renameDescription")}</p>
        <form onSubmit={submit} noValidate>
          <label htmlFor="rename-project-name" className="eyebrow">{t("projectNameLabel")}</label>
          <input ref={field} id="rename-project-name" type="text" autoComplete="off" maxLength={PROJECT_NAME_MAX_LENGTH + 1}
            value={name} disabled={pending} aria-invalid={nameError !== null || failed}
            aria-describedby={nameError || failed ? "rename-project-error" : undefined}
            onChange={(event) => { setName(event.currentTarget.value); setNameError(null); }} />
          <p className="vault-counter">{name.length}/{PROJECT_NAME_MAX_LENGTH}</p>
          {nameError && <p id="rename-project-error" role="alert" className="input-error">{t(nameError)}</p>}
          {!nameError && failed && <p id="rename-project-error" role="alert" className="input-error">
            {t(dialog.error === "UNAUTHORIZED" ? "manageSessionExpired" : "renameFailed")}</p>}
          <div className="vault-dialog-actions">
            <button type="button" className="action-button secondary-button" disabled={pending} onClick={manager.cancel}>{t("vaultCancel")}</button>
            <button type="submit" className="action-button primary-action" disabled={pending}>
              {pending ? t("renamePending") : failed ? t("historyRetry") : t("renameConfirm")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DeleteProjectDialog({ manager, dialog }: SheetProps) {
  const { t } = useLabels();
  const sheet = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const pending = dialog.status === "PENDING";
  const failed = dialog.status === "ERROR";
  const generations = dialog.generationCount === null ? t("deleteGenerationsUnknown")
    : dialog.generationCount === 0 ? t("deleteGenerationsNone")
      : t("deleteGenerations", { count: dialog.generationCount });

  useEffect(() => {
    // The safe action takes focus; the destructive one needs a deliberate move.
    cancel.current?.focus();
    return () => restoreFocus(dialog.trigger);
  }, [dialog.trigger]);

  return (
    <div className="vault-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) manager.cancel(); }}>
      <div ref={sheet} className="vault-dialog raised-panel" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description" aria-busy={pending || undefined} onKeyDown={trapKeys(sheet, pending, manager.cancel)}>
        <p className="eyebrow">{t("deleteEyebrow")}</p>
        <h2 id="delete-dialog-title" className="delete-dialog-title" title={dialog.name}>{t("deleteTitle", { name: dialog.name })}</h2>
        <div id="delete-dialog-description" className="delete-dialog-copy">
          <p>{generations}</p>
          <p><strong>{t("deleteIrreversible")}</strong></p>
          <p className="workspace-intro">{t("deleteKeepsCode")}</p>
        </div>
        {failed && <p role="alert" className="input-error">{t(dialog.error === "UNAUTHORIZED" ? "manageSessionExpired" : "deleteFailed")}</p>}
        <div className="vault-dialog-actions">
          <button ref={cancel} type="button" className="action-button secondary-button" disabled={pending} onClick={manager.cancel}>{t("vaultCancel")}</button>
          <button type="button" className="action-button danger-action" disabled={pending} onClick={() => { void manager.confirmDelete(); }}>
            {pending ? t("deletePending") : failed ? t("historyRetry") : t("deleteConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Single app-level host for the rename and delete confirmations requested from the Vault cards. */
export function ProjectManageDialog({ manager }: { manager: ProjectManager }) {
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  const dialog = state.dialog;
  if (!dialog) return null;
  const key = `${dialog.kind}:${dialog.projectId}`;
  return dialog.kind === "RENAME"
    ? <RenameProjectDialog key={key} manager={manager} dialog={dialog} />
    : <DeleteProjectDialog key={key} manager={manager} dialog={dialog} />;
}
