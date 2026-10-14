import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { useLabels } from "../preferences/useLabels";
import type { ProjectsModel } from "./projectsModel";
import { createAndSelectProject, PROJECT_NAME_MAX_LENGTH, validateProjectName, type ProjectNameError } from "./projectTargetActions";
import { handleVaultDialogKey } from "./vaultKeyboard";

export function NewProjectDialog({ projects, trigger, onClose, onCreated }: {
  projects: ProjectsModel;
  trigger: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useLabels();
  const sheet = useRef<HTMLDivElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const completed = useRef(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<ProjectNameError | null>(null);
  const [createFailed, setCreateFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    nameField.current?.focus();
    return () => { if (!completed.current) trigger.current?.focus(); };
  }, [trigger]);

  function close() {
    if (busy.current) return;
    if (createFailed) projects.clearError();
    onClose();
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const focusable = Array.from(sheet.current?.querySelectorAll<HTMLElement>(
      'input:not(:disabled), button:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
    ) ?? []);
    handleVaultDialogKey(event, busy.current, focusable, document.activeElement, close);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const validation = validateProjectName(name);
    if (!validation.ok) { setNameError(validation.error); return; }
    busy.current = true;
    setCreating(true);
    setCreateFailed(false);
    setNameError(null);
    try {
      const result = await createAndSelectProject(projects, validation.name);
      if (result.status === "CREATED" && projects.getSnapshot().selectedProject?.id === result.project.id) {
        completed.current = true;
        onClose();
        onCreated();
      } else if (result.status === "INVALID") setNameError(result.error);
      else setCreateFailed(true);
    } catch { setCreateFailed(true); }
    finally { busy.current = false; setCreating(false); }
  }

  return (
    <div className="vault-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={sheet} className="vault-dialog raised-panel" role="dialog" aria-modal="true" aria-labelledby="vault-dialog-title"
        aria-describedby="vault-dialog-description" onKeyDown={keys}>
        <p className="eyebrow">{t("vaultDialogEyebrow")}</p>
        <h2 id="vault-dialog-title">{t("vaultDialogTitle")}</h2>
        <p id="vault-dialog-description" className="workspace-intro">{t("vaultDialogDescription")}</p>
        <form onSubmit={(event) => { void submit(event); }} noValidate>
          <label htmlFor="vault-project-name" className="eyebrow">{t("projectNameLabel")}</label>
          <input ref={nameField} id="vault-project-name" type="text" autoComplete="off" maxLength={PROJECT_NAME_MAX_LENGTH + 1}
            value={name} placeholder={t("projectNamePlaceholder")} aria-invalid={nameError !== null || createFailed}
            aria-describedby={nameError || createFailed ? "vault-create-error" : undefined}
            onChange={(event) => { setName(event.currentTarget.value); setNameError(null); setCreateFailed(false); }} />
          <p className="vault-counter">{name.length}/{PROJECT_NAME_MAX_LENGTH}</p>
          {nameError && <p id="vault-create-error" role="alert" className="input-error">{t(nameError)}</p>}
          {createFailed && <p id="vault-create-error" role="alert" className="input-error">{t("projectCreateFailed")}</p>}
          <div className="vault-dialog-actions">
            <button type="button" className="action-button secondary-button" disabled={creating} onClick={close}>{t("vaultCancel")}</button>
            <button type="submit" className="action-button primary-action" disabled={creating}>
              {creating ? t("projectCreating") : t("projectCreate")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
