import { useState, useSyncExternalStore } from "react";
import { ApplicationShell } from "./features/workspace/ApplicationShell";
import { Login } from "./features/login/Login";
import { createAuthModel, createSupabaseAuthProvider, createUnconfiguredAuthProvider, readSupabaseConfig, type AuthModel } from "./features/auth/index";
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
  const [demo, setDemo] = useState(false);

  // An authenticated user enters the application. Otherwise, local demo mode allows testing.
  const showApplication = authState.status === "AUTHENTICATED" || demo;

  return (
    <>
      {!showApplication && (
        <Login
          authModel={model}
          onDemo={() => setDemo(true)}
        />
      )}
      <div hidden={!showApplication}>
        <ApplicationShell
          user={authState.user}
          onLogin={() => {
            if (authState.status === "AUTHENTICATED") {
              void model.signOut();
            }
            setDemo(false);
          }}
        />
      </div>
    </>
  );
}
