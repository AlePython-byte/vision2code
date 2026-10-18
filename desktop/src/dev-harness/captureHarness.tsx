/**
 * V2C capture harness (development only): renders the real application with real workspace services
 * so a screen can be inspected and screenshotted without signing in. Served only by the Vite dev
 * server at /dev/capture-harness.html; nothing imports it, so it never reaches `dist` (guarded by
 * `npm run check:dist-dev-only`). The transport is fake and the auth provider is the unconfigured one:
 * no request leaves the page and nothing here can sign anyone in.
 *
 * Query: ?screen=shell|login   (default shell; "login" renders the real Login with an unconfigured
 *        auth model, the Register tab is one click away)
 *        &analysis=success|pending|error  &theme=light|dark  &lang=es|en
 *        &email=<address, shown only as a tooltip and in Settings>  &uid=<user id: the avatar seed>  &name=<display name for the rail>
 *        &project=1 (preload a generated project for the Code view)
 */
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import uiSchema from "../../../packages/contracts/tests/fixtures/simple-interface.json";
import { UISchemaSchema } from "@vision2code/contracts";
import { createAuthModel, createUnconfiguredAuthProvider } from "../features/auth/index";
import { generateReactProject } from "../features/generation/generateReactProject";
import { Login } from "../features/login/Login";
import { LibraryDialog } from "../features/projects/LibraryDialog";
import { ApplicationShell } from "../features/workspace/ApplicationShell";
import { LibraryNavButton } from "../features/workspace/LibraryNavButton";
import { createWorkspaceServices } from "../features/workspace/workspaceServices";
import { preferences } from "../features/preferences/preferences";
import "../features/preferences/i18n";
import "../styles/theme.css";

const params = new URLSearchParams(location.search);
const analysis = params.get("analysis") ?? "success";
const screen = params.get("screen") ?? "shell";
const email = params.get("email") ?? "designer@example.com";
const uid = params.get("uid") ?? "harness";
const displayName = params.get("name") ?? undefined;
preferences.set({ theme: params.get("theme") === "dark" ? "dark" : "light", language: params.get("lang") === "en" ? "en" : "es" });

const ids = ["6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f", "7a2d3e4f-5b6c-4d7e-9f80-1b2c3d4e5f60"];
const stamp = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const projects = [
  { id: ids[0], name: "Panel de ventas", createdAt: stamp(900), updatedAt: stamp(30), generationCount: 3, latestGenerationId: null },
  { id: ids[1], name: "Landing de producto", createdAt: stamp(3000), updatedAt: stamp(600), generationCount: 1, latestGenerationId: null },
];
const generations = (projectId: string, count: number) => Array.from({ length: count }, (_, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index + 1}`, projectId, sourceImagePath: null, sourceImageName: `captura-${index + 1}.png`,
  sourceImageMimeType: "image/png", generationTarget: "REACT_TAILWIND", fidelityMode: index === 0 ? "BALANCED" : "FAST", createdAt: stamp(20 + index * 90),
}));

const transport: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/analyses")) {
    if (analysis === "error") throw new TypeError("harness: network down");
    if (analysis === "pending") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }
    return Response.json({ requestId: "2d039973-5c41-4983-96a9-5b112e7a35d0", uiSchema });
  }
  if (url.endsWith("/projects")) return Response.json(projects);
  const generationList = /\/projects\/([^/]+)\/generations$/.exec(url);
  if (generationList) return Response.json(generations(generationList[1]!, generationList[1] === ids[0] ? 3 : 1));
  return new Response("harness: no backend", { status: 503 });
};

const services = createWorkspaceServices({
  getAccessToken: async () => "harness-token",
  baseUrl: "http://harness.invalid",
  onUnauthorized: () => {},
  transport,
});
void services.projectsModel.loadProjects();
// ?project=1 preloads a generated project so the Code workspace can be inspected.
if (params.get("project") === "1") {
  const project = generateReactProject(UISchemaSchema.parse(uiSchema));
  services.editorModel.setProject(project);
  services.previewModel.setProject(project);
  void services.previewModel.render();
}

const authModel = createAuthModel(createUnconfiguredAuthProvider());

function HarnessLogin() {
  const [restored, setRestored] = useState(false);
  useEffect(() => { void authModel.restoreSession().then(() => setRestored(true)); }, []);
  return restored ? <Login authModel={authModel} /> : null;
}

function Harness() {
  if (!import.meta.env.DEV) return null;
  if (screen === "login") return <HarnessLogin />;
  return (
    <ApplicationShell onLogin={() => {}} user={{ id: uid, email, emailVerified: true, ...(displayName ? { displayName } : {}) }} services={services}
      libraryNav={<LibraryNavButton library={services.library} />}
      libraryDialog={({ openCode }) => <LibraryDialog library={services.library} projects={services.projectsModel}
        session={services.generationSession} openCode={openCode} hasLocalEdits={() => false}
        confirmDiscard={() => Promise.resolve(true)} />} />
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode><Harness /></React.StrictMode>);
