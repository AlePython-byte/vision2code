/**
 * V2C capture harness (development only): renders the real application shell with real workspace
 * services so the Capture screen can be inspected and screenshotted without signing in. Served only by
 * the Vite dev server at /dev/capture-harness.html; nothing imports it, so it never reaches `dist`
 * (guarded by `npm run check:dist-dev-only`). The transport is fake: no request leaves the page.
 *
 * Query: ?analysis=success|pending|error  &theme=light|dark  &lang=es|en
 */
import React from "react";
import ReactDOM from "react-dom/client";
import uiSchema from "../../../packages/contracts/tests/fixtures/simple-interface.json";
import { ApplicationShell } from "../features/workspace/ApplicationShell";
import { LibraryNavButton } from "../features/workspace/LibraryNavButton";
import { createWorkspaceServices } from "../features/workspace/workspaceServices";
import { preferences } from "../features/preferences/preferences";
import "../features/preferences/i18n";
import "../styles/theme.css";

const params = new URLSearchParams(location.search);
const analysis = params.get("analysis") ?? "success";
preferences.set({ theme: params.get("theme") === "dark" ? "dark" : "light", language: params.get("lang") === "en" ? "en" : "es" });

const transport: typeof fetch = async (input, init) => {
  if (!String(input).endsWith("/analyses")) return new Response("harness: no backend", { status: 503 });
  if (analysis === "error") throw new TypeError("harness: network down");
  if (analysis === "pending") {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  }
  return Response.json({ requestId: "2d039973-5c41-4983-96a9-5b112e7a35d0", uiSchema });
};

const services = createWorkspaceServices({
  getAccessToken: async () => "harness-token",
  baseUrl: "http://harness.invalid",
  onUnauthorized: () => {},
  transport,
});

function Harness() {
  if (!import.meta.env.DEV) return null;
  return (
    <ApplicationShell onLogin={() => {}} user={{ id: "harness", email: "designer@example.com", emailVerified: true }}
      services={services} libraryNav={<LibraryNavButton library={services.library} />} />
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode><Harness /></React.StrictMode>);
