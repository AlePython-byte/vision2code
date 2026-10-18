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
 *        &projects=0|1|2|many (how many projects the fake backend lists, default 2)  &thumbs=ok|error|slow (generation detail answers)
 */
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import uiSchema from "../../../packages/contracts/tests/fixtures/simple-interface.json";
import linearLanding from "../../tests/fixtures/ui-schemas/linear-landing.balanced.p11.v1.json";
import tremorDashboard from "../../tests/fixtures/ui-schemas/tremor-dashboard.balanced.p11.v1.json";
import codepenLogin from "../../tests/fixtures/ui-schemas/codepen-login.balanced.p11.v1.json";
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

const projectsParam = params.get("projects");
const projectCount = projectsParam === "0" ? 0 : projectsParam === "1" ? 1 : projectsParam === "many" ? 14 : 2;
const thumbs = params.get("thumbs") ?? "ok";
const stamp = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const uuid = (kind: number, project: number, generation = 0) =>
  `${kind.toString(16).padStart(8, "0")}-4a5b-4c6d-8e7f-${project.toString(16).padStart(6, "0")}${generation.toString(16).padStart(6, "0")}`;
const names = ["Panel de ventas", "Landing de producto", "Inicio de sesión", "Tablero de métricas", "Página de precios", "Registro de usuarios", "Centro de ayuda"];
const projects = Array.from({ length: projectCount }, (_, index) => ({
  id: uuid(1, index),
  name: index < names.length ? names[index]! : `${names[index % names.length]!} ${Math.floor(index / names.length) + 1}`,
  createdAt: stamp(900 + index * 400), updatedAt: stamp(30 + index * 260),
  generationCount: 1 + (index % 3), latestGenerationId: uuid(2, index, 0),
}));
const generationsOf = (projectId: string) => {
  const index = projects.findIndex((project) => project.id === projectId);
  if (index < 0) return [];
  return Array.from({ length: projects[index]!.generationCount }, (_, generation) => ({
    id: uuid(2, index, generation), projectId, sourceImagePath: null, sourceImageName: `captura-${generation + 1}.png`,
    sourceImageMimeType: "image/png", generationTarget: "REACT_TAILWIND",
    fidelityMode: (["BALANCED", "FAST", "PRECISE"] as const)[(index + generation) % 3], createdAt: stamp(20 + index * 260 + generation * 90),
  }));
};
// A different real schema per generation, so thumbnails differ; the generated project is built once per schema.
const detailSchemas = [linearLanding, tremorDashboard, codepenLogin, uiSchema] as unknown[];
const generatedFor = new Map<number, ReturnType<typeof generateReactProject>>();
function generationDetail(projectId: string, generationId: string) {
  const all = generationsOf(projectId);
  const position = all.findIndex((item) => item.id === generationId);
  if (position < 0) return null;
  const summary = all[position]!;
  const index = projects.findIndex((project) => project.id === projectId);
  const which = (index + position) % detailSchemas.length;
  const schema = UISchemaSchema.parse(detailSchemas[which]);
  if (!generatedFor.has(which)) generatedFor.set(which, generateReactProject(schema));
  return { ...summary, uiSchema: schema, generatedProject: generatedFor.get(which)! };
}

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
  if (generationList) return Response.json(generationsOf(generationList[1]!));
  const generationOne = /\/projects\/([^/]+)\/generations\/([^/]+)$/.exec(url);
  if (generationOne) {
    if (thumbs === "error") return new Response("harness: detail unavailable", { status: 503 });
    if (thumbs === "slow") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }
    const detail = generationDetail(generationOne[1]!, generationOne[2]!);
    return detail ? Response.json(detail) : new Response("harness: not found", { status: 404 });
  }
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
      libraryDialog={({ openCode }) => <LibraryDialog library={services.library} projects={services.projectsModel} thumbnails={services.thumbnails}
        session={services.generationSession} openCode={openCode} hasLocalEdits={() => false}
        confirmDiscard={() => Promise.resolve(true)} />} />
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode><Harness /></React.StrictMode>);
