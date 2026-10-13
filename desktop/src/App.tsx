import { useState, useEffect, useSyncExternalStore } from "react";
import { ApplicationShell } from "./features/workspace/ApplicationShell";
import { Login } from "./features/login/Login";
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
      <div hidden={!showApplication}>
        <ApplicationShell
          user={authState.user}
          onLogin={() => {
            if (authState.status === "AUTHENTICATED") {
              void model.signOut();
            }
          }}
        />
      </div>
    </>
  );
}
