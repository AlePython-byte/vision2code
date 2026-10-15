/**
 * Fixed files that make an exported folder runnable with `npm install && npm run dev`.
 *
 * The scaffold belongs to the exporter, not to the generator: `generateReactProject` and the
 * `GeneratedProject` contract are untouched, and these files are never persisted or shown in the
 * editor. Everything here is pure (no I/O, no timestamps, no randomness) and dependency-free.
 */

import { buildExportPlan, type ExportErrorCode, type ExportFileInput, type ExportPlan } from "./exportPlan.ts";

/** Bump when the template files or their pinned versions change. */
export const EXPORT_SCAFFOLD_VERSION = "1";
export const FALLBACK_PACKAGE_NAME = "vision2code-export";
const MAX_PACKAGE_NAME_CHARS = 50;
const MAX_TITLE_CHARS = 100;

/**
 * Exact versions (no ranges) taken from the versions the desktop app already installs and builds
 * with. Verified end to end by `npm run verify:export-scaffold`.
 */
export const EXPORT_SCAFFOLD_DEPENDENCIES = Object.freeze({
  react: "19.3.0",
  "react-dom": "19.3.0",
});
export const EXPORT_SCAFFOLD_DEV_DEPENDENCIES = Object.freeze({
  "@tailwindcss/vite": "4.3.3",
  "@types/react": "19.3.0",
  "@types/react-dom": "19.3.0",
  "@vitejs/plugin-react": "6.1.1",
  tailwindcss: "4.3.3",
  typescript: "6.0.3",
  vite: "8.3.1",
});

export interface ScaffoldFile {
  readonly path: string;
  readonly content: string;
}

/** Lowercase, URL-safe npm package name: no accents, no spaces, no leading dot/underscore. */
export function sanitizePackageName(projectName: string | null): string {
  const folded = (projectName ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let name = folded.replace(/[^a-z0-9._-]+/g, "-").replace(/-{2,}/g, "-");
  name = name.replace(/^[-._]+|[-._]+$/g, "").slice(0, MAX_PACKAGE_NAME_CHARS).replace(/^[-._]+|[-._]+$/g, "");
  return name || FALLBACK_PACKAGE_NAME;
}

/** Human title for index.html and the README: control characters removed, bounded, never empty. */
function displayTitle(projectName: string | null): string {
  const cleaned = (projectName ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return [...cleaned].slice(0, MAX_TITLE_CHARS).join("") || "Vision2Code";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The fixed project files, in a stable order. Deterministic for a given project name. */
export function buildScaffold(projectName: string | null): readonly ScaffoldFile[] {
  const title = displayTitle(projectName);
  const files: ScaffoldFile[] = [
    {
      path: "package.json",
      content: json({
        name: sanitizePackageName(projectName),
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: { dev: "vite", build: "tsc --noEmit && vite build", preview: "vite preview" },
        dependencies: EXPORT_SCAFFOLD_DEPENDENCIES,
        devDependencies: EXPORT_SCAFFOLD_DEV_DEPENDENCIES,
        engines: { node: ">=22.12.0" },
        vision2code: { scaffoldVersion: EXPORT_SCAFFOLD_VERSION },
      }),
    },
    {
      path: "index.html",
      content: [
        "<!doctype html>",
        '<html lang="es">',
        "  <head>",
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        `    <title>${escapeHtml(title)}</title>`,
        "  </head>",
        "  <body>",
        '    <div id="root"></div>',
        '    <script type="module" src="/src/main.tsx"></script>',
        "  </body>",
        "</html>",
        "",
      ].join("\n"),
    },
    {
      path: "src/main.tsx",
      content: [
        'import { StrictMode } from "react";',
        'import { createRoot } from "react-dom/client";',
        'import App from "./App";',
        'import "./index.css";',
        "",
        'createRoot(document.getElementById("root") as HTMLElement).render(',
        "  <StrictMode>",
        "    <App />",
        "  </StrictMode>,",
        ");",
        "",
      ].join("\n"),
    },
    { path: "src/index.css", content: '@import "tailwindcss";\n' },
    { path: "src/vite-env.d.ts", content: '/// <reference types="vite/client" />\n' },
    {
      path: "vite.config.ts",
      content: [
        'import { defineConfig } from "vite";',
        'import react from "@vitejs/plugin-react";',
        'import tailwindcss from "@tailwindcss/vite";',
        "",
        "export default defineConfig({",
        "  plugins: [react(), tailwindcss()],",
        "});",
        "",
      ].join("\n"),
    },
    {
      path: "tsconfig.json",
      content: json({
        compilerOptions: {
          target: "ES2020",
          lib: ["ES2020", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          skipLibCheck: true,
          isolatedModules: true,
          noEmit: true,
        },
        include: ["src", "vite.config.ts"],
      }),
    },
    {
      path: "README.md",
      content: [
        `# ${title}`,
        "",
        "Proyecto exportado desde Vision2Code (React + Tailwind CSS + Vite).",
        "",
        "## Arrancar",
        "",
        "Requiere Node.js 22.12 o superior.",
        "",
        "```sh",
        "npm install",
        "npm run dev",
        "```",
        "",
        "Abre la dirección que muestra Vite (normalmente http://localhost:5173).",
        "",
        "## Otros comandos",
        "",
        "- `npm run build`: comprueba los tipos y genera la versión de producción en `dist/`.",
        "- `npm run preview`: sirve la versión de producción generada.",
        "",
        "El código de la interfaz está en `src/generated/GeneratedInterface.tsx`.",
        "",
      ].join("\n"),
    },
    { path: ".gitignore", content: "node_modules\ndist\n*.local\n" },
  ];
  return Object.freeze(files.map((file) => Object.freeze(file)));
}

export interface ScaffoldMerge {
  /** Project files followed by the scaffold files that do not collide with them. */
  readonly files: readonly ScaffoldFile[];
  /** Scaffold paths dropped because the generated project already provides that file. */
  readonly omitted: readonly string[];
  readonly scaffoldFileCount: number;
}

/**
 * Generated files win: a scaffold path that matches a project path (ignoring case, as on Windows)
 * is omitted and reported, never overwritten.
 */
export function withScaffold(projectFiles: readonly ScaffoldFile[], projectName: string | null): ScaffoldMerge {
  const taken = new Set(projectFiles.map((file) => file.path.toLowerCase()));
  const omitted: string[] = [];
  const added: ScaffoldFile[] = [];
  for (const file of buildScaffold(projectName)) {
    if (taken.has(file.path.toLowerCase())) omitted.push(file.path);
    else added.push(file);
  }
  return Object.freeze({
    files: Object.freeze([...projectFiles, ...added]),
    omitted: Object.freeze(omitted),
    scaffoldFileCount: added.length,
  });
}

export interface RunnableExportPlan extends ExportPlan {
  readonly scaffold: { readonly version: string; readonly fileCount: number; readonly omitted: readonly string[] };
}
export type RunnableExportPlanResult =
  | { readonly ok: true; readonly plan: RunnableExportPlan }
  | { readonly ok: false; readonly code: ExportErrorCode };

/**
 * The export plan is the working copy plus the scaffold, validated together by the same rules and
 * limits as any export (the native side remains authoritative). An empty working copy is still
 * NO_FILES: the scaffold alone is never exported.
 */
export function buildRunnableExportPlan(files: readonly ExportFileInput[], projectName: string | null): RunnableExportPlanResult {
  if (files.length === 0) return { ok: false, code: "NO_FILES" };
  const merged = withScaffold(files, projectName);
  const plan = buildExportPlan(merged.files, projectName);
  if (!plan.ok) return plan;
  return {
    ok: true,
    plan: Object.freeze({
      ...plan.plan,
      scaffold: Object.freeze({ version: EXPORT_SCAFFOLD_VERSION, fileCount: merged.scaffoldFileCount, omitted: merged.omitted }),
    }),
  };
}
