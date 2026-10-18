import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const FEATURES = fileURLToPath(new URL("../src/features/", import.meta.url));

/**
 * Part of the `require` shim the UI tests give to a transpiled feature file.
 *
 * Those shims hand every unknown name to a `createRequire(import.meta.url)` that lives in `tests/`, so a relative
 * import such as `../account/GeneratedAvatar` resolved against the wrong folder and a new import in a covered file
 * broke every loader at once. A relative name that is not mocked now resolves against the importing file's own folder
 * and is transpiled the same way (.ts and .tsx, recursively). Anything else returns `undefined`, so each loader keeps
 * its own table of mocks and its bare-package fallback (`external`: react, lucide-react, the real modules).
 *
 * `fromFile` is the path under `src/features/` of the file that is importing, as the loaders already receive it.
 */
export function requireLocalSource(fromFile: string, name: string, external: (name: string) => unknown): unknown {
  if (!name.startsWith(".")) return undefined;
  const base = resolve(dirname(resolve(FEATURES, fromFile)), name);
  const path = [base, `${base}.tsx`, `${base}.ts`].find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
  if (!path) return undefined;
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const nested = relative(FEATURES, path);
  runInNewContext(code, { exports, require: (inner: string) => requireLocalSource(nested, inner, external) ?? external(inner) });
  return exports;
}
