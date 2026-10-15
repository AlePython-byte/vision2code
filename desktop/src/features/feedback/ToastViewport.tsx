import { useRef, useSyncExternalStore, type FocusEvent } from "react";
import { AlertTriangle, Check, Info, Loader2, RotateCw, X } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import type { Toast, ToastModel, ToastTone } from "./toastModel";

const lamps: Record<ToastTone, typeof Check> = { success: Check, error: AlertTriangle, info: Info, progress: Loader2 };

function ToastCapsule({ toast, model }: { toast: Toast; model: ToastModel }) {
  const { t } = useLabels();
  // Auto-dismiss waits while the pointer is over the capsule or keyboard focus is inside it.
  const holds = useRef({ hover: false, focus: false });
  function hold(kind: "hover" | "focus", active: boolean) {
    holds.current[kind] = active;
    if (holds.current.hover || holds.current.focus) model.pause(toast.id);
    else model.resume(toast.id);
  }
  const Lamp = lamps[toast.tone];
  const alert = toast.tone === "error";
  return (
    <div className="toast-capsule" data-tone={toast.tone} role={alert ? "alert" : "status"}
      aria-live={alert ? "assertive" : "polite"} aria-atomic="true"
      onMouseEnter={() => hold("hover", true)} onMouseLeave={() => hold("hover", false)}
      onFocus={() => hold("focus", true)}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hold("focus", false);
      }}>
      <span className="toast-lamp" aria-hidden="true"><Lamp className={toast.tone === "progress" ? "toast-spin" : undefined} /></span>
      <div className="toast-body">
        <p className="eyebrow toast-eyebrow">{t(toast.eyebrow)}</p>
        <p className="toast-message">{toast.messageParams ? t(toast.message, toast.messageParams) : t(toast.message)}</p>
      </div>
      <div className="toast-controls">
        {toast.action && (
          <button type="button" className="toast-action" aria-label={t(toast.action.label)} onClick={toast.action.run}>
            <RotateCw aria-hidden="true" /><span>{t(toast.action.label)}</span>
          </button>
        )}
        <button type="button" className="toast-close" aria-label={t("toastDismiss")} title={t("toastDismiss")}
          onClick={() => model.dismiss(toast.id)}>
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** Fixed, out-of-flow toast stack; mounted once at the app level. It never moves focus. */
export function ToastViewport({ model }: { model: ToastModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  return (
    <div className="toast-viewport">
      {state.toasts.map((toast) => <ToastCapsule key={toast.id} toast={toast} model={model} />)}
    </div>
  );
}
