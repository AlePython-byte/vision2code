import { useState, useSyncExternalStore } from "react";
import { ApplicationShell } from "./features/workspace/ApplicationShell";
import { Login } from "./features/login/Login";
import { createAuthModel, createSupabaseAuthProvider, createUnconfiguredAuthProvider, readSupabaseConfig, type AuthModel } from "./features/auth/index";
import "./features/preferences/i18n";
import "./styles/theme.css";

const defaultAuthModel = createAuthModel(
  readSupabaseConfig() ? createSupabaseAuthProvider() : createUnconfiguredAuthProvider()
);

export default function App({ authModel = defaultAuthModel }: { authModel?: AuthModel }) {
  const authState = useSyncExternalStore(authModel.subscribe, authModel.getSnapshot);
  const [demo, setDemo] = useState(false);

  // An authenticated user enters the application. Otherwise, local demo mode allows testing.
  const showApplication = authState.status === "AUTHENTICATED" || demo;

  return (
    <>
      {!showApplication && <Login onDemo={() => setDemo(true)} />}
      <div hidden={!showApplication}>
        <ApplicationShell
          onLogin={() => {
            if (authState.status === "AUTHENTICATED") {
              void authModel.signOut();
            }
            setDemo(false);
          }}
        />
      </div>
    </>
  );
}
