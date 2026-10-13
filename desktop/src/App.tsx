import { useState, useEffect, useSyncExternalStore } from "react";
import { ApplicationShell } from "./features/workspace/ApplicationShell";
import { Login } from "./features/login/Login";
import { GenerationSaveStatus } from "./features/generation/GenerationSaveStatus";
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
          editorStatus={<GenerationSaveStatus session={services.generationSession} projects={services.projectsModel} />}
          onLogin={() => {
            if (authState.status === "AUTHENTICATED") {
              void model.signOut();
            }
          }}
        />
      )}
    </>
  );
}
