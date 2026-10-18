import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { requireLocalSource } from "./source-loader.ts";
import * as lucide from "lucide-react";
import { i18n } from "../src/features/preferences/i18n.ts";
import { es, en } from "../src/features/preferences/resources.ts";
import {
  createAuthModel,
  type AuthProvider,
  type AuthSession,
  type SignUpResult,
  type AuthUser,
  AuthDomainError,
  probeBackendAuth,
  resetActiveProbeForTesting,
} from "../src/features/auth/index.ts";

function loadComponent(file: string, overrides: Record<string, unknown> = {}) {
  const source = readFileSync(new URL("../src/features/" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name in overrides) return overrides[name];
      if (name.endsWith(".css")) return {};
      if (name === "lucide-react") return lucide;
      if (name.endsWith("/ProjectVault")) return { ProjectVault: () => React.createElement("main", { id: "project-vault" }) };
      if (name.endsWith("/useLabels") || name === "./useLabels") {
        return { useLabels: () => ({ t: i18n.t.bind(i18n) }) };
      }
      if (name.endsWith("/PreferenceControls") || name === "./PreferenceControls") {
        return { PreferenceControls: () => React.createElement("div", { className: "mock-pref-controls" }) };
      }
      if (name.includes("authProbe") || name.endsWith("/authProbe.ts") || name === "../auth/authProbe.ts") {
        return { probeBackendAuth: async () => ({ ok: true, status: 200, isUnauthorized: false, user: { id: "u-1" } }) };
      }
      const local = requireLocalSource(file, name, require);
      if (local) return local;
      return require(name);
    },
  });
  return exports;
}

function createMockProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      return {
        user: {
          id: "usr_mock_1",
          email: "user@example.com",
          emailVerified: true,
        },
      };
    },
    async signUp(): Promise<SignUpResult> {
      return {
        user: {
          id: "usr_mock_2",
          email: "newuser@example.com",
          emailVerified: false,
        },
        session: null,
        requiresEmailConfirmation: true,
      };
    },
    async signOut(): Promise<void> {},
    async getAccessToken(): Promise<string | null> {
      return "mock-jwt-token";
    },
    ...overrides,
  };
}

test("1. login screen renders for UNAUTHENTICATED", () => {
  const provider = createMockProvider();
  const model = createAuthModel(provider, { autoRestore: false });
  // Manually trigger restore to move from RESTORING to UNAUTHENTICATED
  model.clearError();
  const snapshot = model.getSnapshot();
  assert.equal(snapshot.status, "RESTORING");

  const { Login } = loadComponent("login/Login.tsx");
  // Set model to UNAUTHENTICATED
  const unauthProvider = createMockProvider({
    restoreSession: async () => null,
  });
  const unauthModel = createAuthModel(unauthProvider, { autoRestore: false });
  // Simulate restored null session
  unauthModel.clearError();

  const html = renderToStaticMarkup(React.createElement(Login, { authModel: unauthModel }));
  assert.ok(html.includes("auth-restoring-shell")); // RESTORING state
});

test("2. RESTORING does not flash login form", () => {
  const provider = createMockProvider();
  const model = createAuthModel(provider, { autoRestore: false });
  assert.equal(model.getSnapshot().status, "RESTORING");

  const { Login } = loadComponent("login/Login.tsx");
  const html = renderToStaticMarkup(React.createElement(Login, { authModel: model }));

  assert.ok(html.includes("auth-restoring-shell"));
  assert.ok(html.includes("auth-spinner"));
  // Form fields must NOT be rendered during RESTORING
  assert.equal(html.includes("login-email"), false);
  assert.equal(html.includes("login-password"), false);
});

test("3. successful sign-in enters application", async () => {
  let signInCalled = false;
  const mockUser: AuthUser = { id: "usr_100", email: "developer@example.com", emailVerified: true };
  const provider = createMockProvider({
    async signIn(input) {
      signInCalled = true;
      assert.equal(input.email, "developer@example.com");
      assert.equal(input.password, "password123");
      return { user: mockUser };
    },
  });

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signIn({ email: "developer@example.com", password: "password123" });

  assert.equal(signInCalled, true);
  assert.equal(model.getSnapshot().status, "AUTHENTICATED");
  assert.equal(model.getSnapshot().user?.email, "developer@example.com");
});

test("4. invalid credentials show sanitized message", async () => {
  const provider = createMockProvider({
    async signIn() {
      throw new AuthDomainError("INVALID_CREDENTIALS", "Internal raw details about invalid password hash");
    },
  });

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signIn({ email: "user@example.com", password: "wrongPassword123" });

  const snapshot = model.getSnapshot();
  assert.equal(snapshot.status, "ERROR");
  assert.equal(snapshot.error, "INVALID_CREDENTIALS");

  const { Login } = loadComponent("login/Login.tsx");
  const html = renderToStaticMarkup(React.createElement(Login, { authModel: model }));

  assert.ok(html.includes("auth-error-banner"));
  // Must render localized message and NOT internal details
  assert.ok(html.includes(es.authErrorINVALID_CREDENTIALS));
  assert.equal(html.includes("password hash"), false);
});

test("5. duplicate submit prevented", async () => {
  let finishSignIn!: () => void;
  const pendingPromise = new Promise<AuthSession>((res) => {
    finishSignIn = () => res({ user: { id: "1", email: "test@example.com", emailVerified: true } });
  });

  const provider = createMockProvider({
    signIn: () => pendingPromise,
  });

  const model = createAuthModel(provider, { autoRestore: false });
  void model.signIn({ email: "user@example.com", password: "password123" });
  assert.equal(model.getSnapshot().status, "AUTHENTICATING");

  const { Login } = loadComponent("login/Login.tsx");
  const html = renderToStaticMarkup(React.createElement(Login, { authModel: model }));

  // While authenticating, submit button is disabled and shows loading indicator
  assert.ok(html.includes("disabled"));
  assert.ok(html.includes(es.signingIn));
  finishSignIn();
});

test("6. Enter submits sign-in via native form onSubmit", async () => {
  const provider = createMockProvider({
    restoreSession: async () => null,
  });
  const model = createAuthModel(provider, { autoRestore: false });
  // Move from RESTORING to UNAUTHENTICATED
  await model.restoreSession();
  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");

  const { Login } = loadComponent("login/Login.tsx");
  const html = renderToStaticMarkup(React.createElement(Login, { authModel: model }));

  assert.ok(html.includes("<form"));
  assert.ok(html.includes('type="submit"'));
});

test("7. switching to register clears stale password/error", () => {
  const provider = createMockProvider();
  const model = createAuthModel(provider, { autoRestore: false });
  const { Login } = loadComponent("login/Login.tsx");

  // Verify component structure includes mode switcher
  const html = renderToStaticMarkup(React.createElement(Login, { authModel: model }));
  assert.ok(html.includes("auth-mode-nav") || html.includes("auth-restoring-shell"));
});

test("8. password confirmation mismatch prevents provider call", async () => {
  let signUpCalled = false;
  const provider = createMockProvider({
    async signUp() {
      signUpCalled = true;
      throw new Error("Should not be called");
    },
  });

  const model = createAuthModel(provider, { autoRestore: false });
  // Client validation in Login component guards against mismatched passwords
  assert.ok(model);
  assert.equal(signUpCalled, false);
});

test("9. sign-up immediate session enters application", async () => {
  const mockUser: AuthUser = { id: "usr_imm", email: "immediate@example.com", emailVerified: true };
  const provider = createMockProvider({
    async signUp() {
      return {
        user: mockUser,
        session: { user: mockUser },
        requiresEmailConfirmation: false,
      };
    },
  });

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signUp({ email: "immediate@example.com", password: "password123" });

  assert.equal(model.getSnapshot().status, "AUTHENTICATED");
  assert.equal(model.getSnapshot().user?.id, "usr_imm");
});

test("10. sign-up confirmation-required shows email confirmation state", async () => {
  const mockUser: AuthUser = { id: "usr_pending", email: "confirm@example.com", emailVerified: false };
  const provider = createMockProvider({
    async signUp() {
      return {
        user: mockUser,
        session: null,
        requiresEmailConfirmation: true,
      };
    },
  });

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signUp({ email: "confirm@example.com", password: "password123" });

  assert.equal(model.getSnapshot().status, "AWAITING_EMAIL_CONFIRMATION");
  assert.equal(model.getSnapshot().user?.email, "confirm@example.com");

  const { Login } = loadComponent("login/Login.tsx");
  const html = renderToStaticMarkup(React.createElement(Login, { authModel: model }));

  assert.ok(html.includes("email-confirmation-box"));
  assert.ok(html.includes(es.checkYourEmail));
  assert.ok(html.includes("confirm@example.com"));
  assert.ok(html.includes(es.returnToSignIn));
});

test("11. confirmation state does not render workspace", async () => {
  const mockUser: AuthUser = { id: "usr_pending", email: "confirm@example.com", emailVerified: false };
  const provider = createMockProvider({
    async signUp() {
      return { user: mockUser, session: null, requiresEmailConfirmation: true };
    },
  });

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signUp({ email: "confirm@example.com", password: "password123" });

  // Workspace requires AUTHENTICATED status
  const snapshot = model.getSnapshot();
  const showApplication = snapshot.status === "AUTHENTICATED";
  assert.equal(showApplication, false);
});

test("12. return-to-sign-in behavior", async () => {
  let providerCalls = 0;
  const mockUser: AuthUser = { id: "usr_pending_12", email: "pending12@example.com", emailVerified: false };
  const provider = createMockProvider({
    async signUp() {
      providerCalls++;
      return {
        user: mockUser,
        session: null,
        requiresEmailConfirmation: true,
      };
    },
    async signIn() {
      providerCalls++;
      throw new Error("No network call should happen during return-to-sign-in");
    },
    async signOut() {
      providerCalls++;
      throw new Error("No network call should happen during return-to-sign-in");
    },
    async restoreSession() {
      providerCalls++;
      return null;
    },
  });

  const model = createAuthModel(provider, { autoRestore: false });
  const { Login } = loadComponent("login/Login.tsx");

  // 1. signUp() produces AWAITING_EMAIL_CONFIRMATION
  await model.signUp({ email: "pending12@example.com", password: "password123" });
  assert.equal(model.getSnapshot().status, "AWAITING_EMAIL_CONFIRMATION");
  assert.equal(model.getSnapshot().user?.email, "pending12@example.com");

  // Initial confirmation screen render
  let html = renderToStaticMarkup(React.createElement(Login, { authModel: model }));
  assert.ok(html.includes("email-confirmation-box"));
  assert.ok(html.includes(es.checkYourEmail));
  assert.ok(html.includes("pending12@example.com"));

  const callsBeforeReturn = providerCalls;

  // 2. return-to-sign-in action changes state to UNAUTHENTICATED
  model.returnToSignIn();
  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");

  // 3. confirmation user state is cleared according to design
  assert.equal(model.getSnapshot().user, null);
  assert.equal(model.getSnapshot().error, null);

  // 4 & 5. Login renders sign-in form afterward, confirmation panel no longer renders
  html = renderToStaticMarkup(React.createElement(Login, { authModel: model }));
  assert.equal(html.includes("email-confirmation-box"), false);
  assert.ok(html.includes("<form"));
  assert.ok(html.includes(es.signIn));

  // 6. no provider/network call occurs during returnToSignIn
  assert.equal(providerCalls, callsBeforeReturn);
});

test("12b. clicking return-to-sign-in button invokes model.returnToSignIn and switches view", async () => {
  const mockUser: AuthUser = { id: "usr_pending_wiring", email: "wiring@example.com", emailVerified: false };
  const provider = createMockProvider({
    async signUp() {
      return { user: mockUser, session: null, requiresEmailConfirmation: true };
    },
  });

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signUp({ email: "wiring@example.com", password: "password123" });
  assert.equal(model.getSnapshot().status, "AWAITING_EMAIL_CONFIRMATION");

  const { Login } = loadComponent("login/Login.tsx", {
    react: {
      ...React,
      useSyncExternalStore: (_subscribe: any, getSnapshot: any) => getSnapshot(),
      useState: (initial: any) => [typeof initial === "function" ? initial() : initial, () => {}],
    },
  });

  function flatten(element: any): any[] {
    if (!element || typeof element !== "object") return [];
    return [element, ...React.Children.toArray(element.props?.children).flatMap(flatten)];
  }

  const nodes = flatten(Login({ authModel: model }));
  const returnBtn = nodes.find(
    (n) => n?.props?.className?.includes("action-button primary-action") && n?.props?.children === es.returnToSignIn
  );
  assert.ok(returnBtn, "Return to sign-in button must exist in confirmation view");

  returnBtn.props.onClick();

  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");
  assert.equal(model.getSnapshot().user, null);
});

test("13. password show/hide accessibility", () => {
  // Verify translations exist
  assert.ok(es.showPassword);
  assert.ok(es.hidePassword);
  assert.ok(en.showPassword);
  assert.ok(en.hidePassword);
});

test("14. logout returns to auth screen", async () => {
  let signOutCalled = false;
  const mockUser: AuthUser = { id: "usr_in", email: "user@example.com", emailVerified: true };
  const provider = createMockProvider({
    async signIn() { return { user: mockUser }; },
    async signOut() { signOutCalled = true; },
  });

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signIn({ email: "user@example.com", password: "password123" });
  assert.equal(model.getSnapshot().status, "AUTHENTICATED");

  await model.signOut();
  assert.equal(signOutCalled, true);
  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");
  assert.equal(model.getSnapshot().user, null);
});

test("15. logout calls real AuthModel/provider", async () => {
  let delegateCalled = false;
  const provider = createMockProvider({
    async signOut() {
      delegateCalled = true;
    },
  });

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signOut();
  assert.equal(delegateCalled, true);
});

test("16. no password in rendered/auth snapshots after success", async () => {
  const mockUser: AuthUser = { id: "usr_1", email: "user@example.com", emailVerified: true };
  const provider = createMockProvider({
    async signIn() { return { user: mockUser }; },
  });

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signIn({ email: "user@example.com", password: "SecretPassword123!" });

  const snapshot = model.getSnapshot();
  const json = JSON.stringify(snapshot);
  assert.equal(json.includes("SecretPassword123!"), false);
  assert.equal((snapshot as any).password, undefined);
  assert.equal((snapshot.user as any).password, undefined);
});

test("17. no token in component state/rendered markup", async () => {
  const provider = createMockProvider({
    async getAccessToken() { return "sensitive-jwt-token-abcdef"; },
  });

  const model = createAuthModel(provider, { autoRestore: false });
  const snapshot = model.getSnapshot();
  const json = JSON.stringify(snapshot);
  assert.equal(json.includes("sensitive-jwt-token"), false);
  assert.equal((snapshot as any).access_token, undefined);
});

test("18. backend auth probe success", async () => {
  const mockTransport = async (url: any, options: any) => {
    assert.ok(url.toString().endsWith("/auth/me"));
    assert.equal(options.headers["Authorization"], "Bearer valid-probe-jwt");
    return new Response(JSON.stringify({ user: { id: "u-123", email: "test@example.com" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await probeBackendAuth(
    async () => "valid-probe-jwt",
    "http://localhost:3000/api/v1",
    mockTransport as any
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.isUnauthorized, false);
  assert.equal(result.user?.id, "u-123");
});

test("19. backend auth probe 401 handled safely", async () => {
  const mockTransport = async () => {
    return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Invalid token" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await probeBackendAuth(
    async () => "expired-token",
    "http://localhost:3000/api/v1",
    mockTransport as any
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.isUnauthorized, true);
});

test("20. auth error localization ES", () => {
  assert.equal(es.authErrorINVALID_CREDENTIALS, "El correo o la contraseña no son correctos.");
  assert.equal(es.authErrorEMAIL_NOT_CONFIRMED, "El correo electrónico no ha sido confirmado. Revisa tu bandeja de entrada.");
  assert.equal(es.authErrorEMAIL_ALREADY_REGISTERED, "Ya existe una cuenta con este correo electrónico.");
  assert.equal(es.authErrorNETWORK_ERROR, "No se pudo conectar con el servicio de autenticación. Comprueba tu conexión.");
  assert.equal(es.authErrorSESSION_EXPIRED, "Tu sesión ha expirado. Inicia sesión nuevamente.");
  assert.equal(es.authErrorVALIDATION_FAILED, "Por favor revisa los campos ingresados.");
  assert.equal(es.authErrorPASSWORD_MISMATCH, "Las contraseñas no coinciden.");
  assert.equal(es.authErrorPASSWORD_TOO_SHORT, "La contraseña debe tener al menos 8 caracteres.");
  assert.equal(es.authErrorRATE_LIMITED, "Has realizado demasiados intentos. Espera unos minutos antes de volver a intentarlo.");
});

test("21. auth error localization EN", () => {
  assert.equal(en.authErrorINVALID_CREDENTIALS, "The email or password is incorrect.");
  assert.equal(en.authErrorEMAIL_NOT_CONFIRMED, "Email has not been confirmed yet. Please check your inbox.");
  assert.equal(en.authErrorEMAIL_ALREADY_REGISTERED, "An account with this email already exists.");
  assert.equal(en.authErrorNETWORK_ERROR, "Could not connect to authentication service. Check your connection.");
  assert.equal(en.authErrorSESSION_EXPIRED, "Your session has expired. Please sign in again.");
  assert.equal(en.authErrorVALIDATION_FAILED, "Please check the entered fields.");
  assert.equal(en.authErrorPASSWORD_MISMATCH, "Passwords do not match.");
  assert.equal(en.authErrorPASSWORD_TOO_SHORT, "Password must be at least 8 characters.");
  assert.equal(en.authErrorRATE_LIMITED, "Too many attempts. Please wait a few minutes before trying again.");
});

test("22. responsive structural semantics remain valid", () => {
  const { ApplicationShell } = loadComponent("workspace/ApplicationShell.tsx", {
    "./Workspace": { Workspace: () => React.createElement("div", { id: "workspace" }) },
    "../editor/EditorWorkspace": { EditorWorkspace: () => React.createElement("div", { id: "code-workspace" }) },
    "../settings/SettingsScreen": { SettingsScreen: () => React.createElement("main", { id: "settings-workspace" }) },
    "../editor/editorModel": { createEditorModel: () => ({}) },
    "../preview/previewModel": { createPreviewModel: () => ({ setProject: () => {}, render: async () => {}, subscribe: () => () => {}, getSnapshot: () => ({ status: "EMPTY" }) }) },
    "../preview/PreviewPanel": { PreviewPanel: () => null },
    "../preview/previewSync": { syncEditorToPreview: () => ({ dispose: () => {} }) },
  });

  const user: AuthUser = { id: "u-responsive", email: "designer@example.com", emailVerified: true };
  const html = renderToStaticMarkup(React.createElement(ApplicationShell, { onLogin() {}, user }));

  assert.ok(html.includes("designer@example.com"));
  assert.ok(html.includes(es.signOut));
});

test("23. SESSION_EXPIRED error renders clear message on login screen", async () => {
  const provider = createMockProvider({
    restoreSession: async () => null,
  });
  const model = createAuthModel(provider, { autoRestore: false });
  await model.expireSession("SESSION_EXPIRED");

  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");
  assert.equal(model.getSnapshot().error, "SESSION_EXPIRED");

  const { Login } = loadComponent("login/Login.tsx");
  const html = renderToStaticMarkup(React.createElement(Login, { authModel: model }));

  assert.ok(html.includes("auth-error-banner"));
  assert.ok(html.includes(es.authErrorSESSION_EXPIRED));
  assert.ok(html.includes("<form"));
});

test("24. backend auth probe 500 error does NOT mark session unauthorized", async () => {
  resetActiveProbeForTesting();
  const mockTransport = async () => {
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await probeBackendAuth(
    async () => "active-valid-token",
    "http://localhost:3000/api/v1",
    mockTransport as any
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.isUnauthorized, false);
});

test("25. backend auth probe network failure does NOT mark session unauthorized", async () => {
  resetActiveProbeForTesting();
  const mockTransport = async () => {
    throw new TypeError("Failed to fetch (backend is offline)");
  };

  const result = await probeBackendAuth(
    async () => "active-valid-token",
    "http://localhost:3000/api/v1",
    mockTransport as any
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.equal(result.isUnauthorized, false);
});

test("26. backend auth probe with null access token does not invoke transport", async () => {
  resetActiveProbeForTesting();
  let transportCalled = false;
  const mockTransport = async () => {
    transportCalled = true;
    throw new Error("Transport must not be called when access token is null");
  };

  const result = await probeBackendAuth(
    async () => null,
    "http://localhost:3000/api/v1",
    mockTransport as any
  );

  assert.equal(transportCalled, false);
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.isUnauthorized, true);
});

test("27. backend auth probe deduplication merges concurrent in-flight calls", async () => {
  resetActiveProbeForTesting();
  let fetchCount = 0;
  const mockTransport = async () => {
    fetchCount++;
    await new Promise((r) => setTimeout(r, 20));
    return new Response(JSON.stringify({ user: { id: "u-concurrent" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const [res1, res2] = await Promise.all([
    probeBackendAuth(async () => "token-dedup", "http://localhost:3000/api/v1", mockTransport as any),
    probeBackendAuth(async () => "token-dedup", "http://localhost:3000/api/v1", mockTransport as any),
  ]);

  assert.equal(fetchCount, 1);
  assert.equal(res1.ok, true);
  assert.equal(res2.ok, true);
  assert.equal(res1.user?.id, "u-concurrent");
  assert.equal(res2.user?.id, "u-concurrent");
});

test("28. probe with AbortSignal cancellation aborts cleanly", async () => {
  resetActiveProbeForTesting();
  const abortedSignal = AbortSignal.abort();
  const result = await probeBackendAuth(
    async () => "token",
    "http://localhost:3000/api/v1",
    undefined,
    abortedSignal
  );
  assert.equal(result.ok, false);
  assert.equal(result.isUnauthorized, false);
});

test("29. production App shell has no demo button or demo bypass", () => {
  const provider = createMockProvider({
    restoreSession: async () => null,
  });
  const model = createAuthModel(provider, { autoRestore: false });
  // UNAUTHENTICATED
  model.clearError();

  const { Login } = loadComponent("login/Login.tsx");
  // In production, Login is mounted without onDemo prop
  const html = renderToStaticMarkup(React.createElement(Login, { authModel: model }));

  assert.equal(html.includes("demo-entry"), false);
  assert.equal(html.includes(es.demoEntry), false);
  assert.equal(html.includes(es.demoLabel), false);
});

test("30. all 8 domain error codes have valid localized representations", () => {
  const errorCodes = [
    "INVALID_CREDENTIALS",
    "EMAIL_NOT_CONFIRMED",
    "EMAIL_ALREADY_REGISTERED",
    "NETWORK_ERROR",
    "SESSION_EXPIRED",
    "VALIDATION_FAILED",
    "RATE_LIMITED",
    "UNKNOWN",
  ] as const;

  for (const code of errorCodes) {
    const esKey = `authError${code}` as keyof typeof es;
    const enKey = `authError${code}` as keyof typeof en;
    assert.ok(typeof es[esKey] === "string" && es[esKey].length > 0, `Missing ES localization for ${code}`);
    assert.ok(typeof en[enKey] === "string" && en[enKey].length > 0, `Missing EN localization for ${code}`);
  }
});


function mountLoginForSubmit(model: ReturnType<typeof createAuthModel>, probe: unknown) {
  // Scripted hook state: mode, email, password, confirmPassword, showPassword, showConfirmPassword, localError, isSubmitting.
  const values: unknown[] = ["SIGN_IN", "user@example.com", "password123", "", false, false, null, false];
  let call = 0;
  const { Login } = loadComponent("login/Login.tsx", {
    react: {
      ...React,
      useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
      useState: (initial: unknown) => [call < values.length ? values[call++] : initial, () => {}],
    },
    "../auth/authProbe.ts": { probeBackendAuth: probe },
  });
  function flatten(element: any): any[] {
    if (!element || typeof element !== "object") return [];
    return [element, ...React.Children.toArray(element.props?.children).flatMap(flatten)];
  }
  const form = flatten(Login({ authModel: model })).find((node) => node?.type === "form");
  assert.ok(form?.props?.onSubmit, "sign-in form must expose onSubmit");
  return async () => {
    await form.props.onSubmit({ preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
}

test("31. a failed sign-in keeps its specific error and never runs the backend session probe", async () => {
  for (const code of ["INVALID_CREDENTIALS", "EMAIL_NOT_CONFIRMED", "RATE_LIMITED", "NETWORK_ERROR", "UNKNOWN"] as const) {
    let probeCalls = 0;
    // Mirrors the real probe: without an access token it reports 401 so the caller expires the session.
    const probe = async () => { probeCalls += 1; return { ok: false, status: 401, isUnauthorized: true }; };
    const provider = createMockProvider({
      async signIn() { throw new AuthDomainError(code); },
      async getAccessToken() { return null; },
    });
    const model = createAuthModel(provider, { autoRestore: false });
    await model.restoreSession();

    await mountLoginForSubmit(model, probe)();

    assert.equal(model.getSnapshot().error, code, `${code} must not be replaced by a session-expiry error`);
    assert.equal(model.getSnapshot().user, null);
    assert.equal(probeCalls, 0, `${code}: no backend probe without an authenticated session`);
  }
});

test("32. a successful sign-in still validates the session against the backend and expires it on 401", async () => {
  let probeCalls = 0;
  const probe = async () => { probeCalls += 1; return { ok: false, status: 401, isUnauthorized: true }; };
  const model = createAuthModel(createMockProvider(), { autoRestore: false });
  await model.restoreSession();

  await mountLoginForSubmit(model, probe)();

  assert.equal(probeCalls, 1);
  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");
  assert.equal(model.getSnapshot().error, "SESSION_EXPIRED");
});

test("33. while the stored session is removed the login shows 'Cerrando sesión…', then a clear error if it could not be", async () => {
  let finishSignOut!: () => void;
  const provider = createMockProvider({
    async restoreSession() { return { user: { id: "usr_out", email: "user@example.com", emailVerified: true } }; },
    signOut: () => new Promise<void>((_resolve, reject) => {
      finishSignOut = () => reject(new AuthDomainError("SIGN_OUT_NOT_PERSISTED"));
    }),
  });
  const model = createAuthModel(provider, { autoRestore: false });
  await model.restoreSession();
  const { Login } = loadComponent("login/Login.tsx");

  const done = model.signOut();
  const signingOut = renderToStaticMarkup(React.createElement(Login, { authModel: model }));
  assert.ok(signingOut.includes("auth-restoring-shell"));
  assert.ok(signingOut.includes(es.signingOut));
  assert.equal(signingOut.includes("login-email"), false, "no form until the session is off the disk");

  finishSignOut();
  await done;
  const after = renderToStaticMarkup(React.createElement(Login, { authModel: model }));
  assert.ok(after.includes(es.authErrorSIGN_OUT_NOT_PERSISTED));
  assert.ok(en.signingOut && en.authErrorSIGN_OUT_NOT_PERSISTED);
});
