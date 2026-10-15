import { lazy, Suspense, useState, useEffect, useSyncExternalStore } from "react";
import { ApplicationShell } from "./features/workspace/ApplicationShell";
import { Login } from "./features/login/Login";
import { ToastViewport } from "./features/feedback/ToastViewport";
import { DiscardDialog } from "./features/projects/DiscardDialog";
import { LibraryDialog } from "./features/projects/LibraryDialog";
import { ProjectManageDialog } from "./features/projects/ProjectManageDialogs";
import { ExportButton } from "./features/export/ExportButton";
import { LibraryNavButton } from "./features/workspace/LibraryNavButton";
import { CodeContext } from "./features/workspace/CodeContext";
import { bindWorkspaceToAuth, createWorkspaceServices } from "./features/workspace/workspaceServices";
import {
  createAuthModel,
  createSupabaseAuthProvider,
  createUnconfiguredAuthProvider,
  readSupabaseConfig,
  probeBackendAuth,
  type AuthModel,
} from "./features/auth/index";
import "./features/preferences/i18n";
import "./styles/theme.css";

// Development-only schema inspector. The dynamic import sits behind the compile-time DEV constant, so
// production builds drop the component, its metrics and its styles (verified with a marker check).
const SchemaInspector = import.meta.env.DEV ? lazy(() => import("./features/fidelity/SchemaInspector")) : null;

function createDefaultAuthModel(): AuthModel {
  return createAuthModel(
    readSupabaseConfig() ? createSupabaseAuthProvider() : createUnconfiguredAuthProvider()
  );
}

export default function App({ authModel }: { authModel?: AuthModel }) {
  const [model] = useState(() => authModel ?? createDefaultAuthModel());
  const authState = useSyncExternalStore(model.subscribe, model.getSnapshot);
  // User-scoped projects, generation session, editor and preview; tokens stay inside the auth model.
  const [services] = useState(() => createWorkspaceServices({
    getAccessToken: model.getAccessToken,
    baseUrl: import.meta.env.VITE_API_BASE_URL,
    onUnauthorized: () => {
      if (model.getSnapshot().status === "AUTHENTICATED") void model.expireSession("SESSION_EXPIRED");
    },
  }));

  // Load projects on sign-in; clear every user-scoped state on sign-out or expiration.
  useEffect(() => bindWorkspaceToAuth(model, services), [model, services]);

  // Validate session against backend when authenticated. If 401, expire the session.
  useEffect(() => {
    if (authState.status !== "AUTHENTICATED") {
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    void probeBackendAuth(model.getAccessToken, undefined, undefined, controller.signal).then(
      (probe) => {
        if (!isMounted) return;
        if (probe.isUnauthorized) {
          void model.expireSession("SESSION_EXPIRED");
        }
      }
    );

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [authState.status, model]);

  // Production entry requires an authenticated session.
  const showApplication = authState.status === "AUTHENTICATED";

  return (
    <>
      {!showApplication && (
        <Login authModel={model} />
      )}
      {/* Unmounted (not hidden) when signed out, so capture state never reaches the next user. */}
      {showApplication && (
        <ApplicationShell
          key={authState.user?.id}
          user={authState.user}
          services={services}
          codeContext={<CodeContext editor={services.editorModel} session={services.generationSession}
            projects={services.projectsModel} history={services.history} discardGuard={services.discardGuard}
            onOpenLibrary={(projectId, trigger) => services.library.openDialog(projectId, trigger)} />}
          codeActions={<>
            <ExportButton exporter={services.exporter} editor={services.editorModel} />
            {SchemaInspector && <Suspense fallback={null}><SchemaInspector session={services.generationSession} /></Suspense>}
          </>}
          libraryNav={<LibraryNavButton library={services.library} />}
          libraryDialog={({ openCode }) => <LibraryDialog library={services.library} projects={services.projectsModel}
            session={services.generationSession} openCode={openCode}
            hasLocalEdits={() => services.editorModel.getSnapshot().drafts.size > 0}
            confirmDiscard={(trigger) => services.discardGuard.request(trigger)} />}
          onLogin={() => {
            if (authState.status === "AUTHENTICATED") {
              void model.signOut();
            }
          }}
        />
      )}
      {/* Single floating feedback layer; cleared with the rest of the user state on sign-out. */}
      <DiscardDialog guard={services.discardGuard} />
      {/* Single host for the Vault's rename/delete confirmations; reset() also closes it on sign-out. */}
      {showApplication && <ProjectManageDialog manager={services.projectManager} />}
      <ToastViewport model={services.toasts} />
    </>
  );
}
