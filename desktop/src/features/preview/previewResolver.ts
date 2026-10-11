/**
 * Deterministic module resolution for Vision2Code preview projects.
 *
 * Enforces:
 * - One canonical normalized module ID format (forward-slash, root-relative, no leading dot/slash).
 * - Relative resolution with traversal protection outside virtual project root.
 * - Deterministic extension resolution (.ts, .tsx, .js, .jsx, and index.*).
 * - Support for explicit virtual modules (react, react-dom, react-dom/client).
 * - Zero arbitrary npm package resolution.
 */

export function normalizeModulePath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    return "";
  }
  const normalized = rawPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const stack: string[] = [];

  for (const segment of parts) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length === 0) {
        throw new Error(`Path traversal outside project root: ${rawPath}`);
      }
      stack.pop();
    } else {
      stack.push(segment);
    }
  }

  return stack.join("/");
}

export function resolveRelativeSpecifier(callerPath: string, specifier: string): string {
  const spec = (specifier || "").replace(/\\/g, "/");
  const isRelative =
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec === "." ||
    spec === "..";

  const dirStack: string[] = [];
  if (isRelative) {
    const callerNormalized = normalizeModulePath(callerPath);
    const callerParts = callerNormalized.split("/");
    if (callerParts.length > 1) {
      dirStack.push(...callerParts.slice(0, -1));
    }
  }

  const specParts = spec.split("/");
  for (const segment of specParts) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (dirStack.length === 0) {
        throw new Error(`Path traversal outside project root: ${specifier}`);
      }
      dirStack.pop();
    } else {
      dirStack.push(segment);
    }
  }

  return dirStack.join("/");
}

export function getCandidateModuleIds(resolvedPath: string): string[] {
  return [
    resolvedPath,
    `${resolvedPath}.ts`,
    `${resolvedPath}.tsx`,
    `${resolvedPath}.js`,
    `${resolvedPath}.jsx`,
    `${resolvedPath}/index.ts`,
    `${resolvedPath}/index.tsx`,
    `${resolvedPath}/index.js`,
    `${resolvedPath}/index.jsx`,
  ];
}

export function resolveModuleId(
  callerPath: string,
  specifier: string,
  registeredModuleIds: Iterable<string>,
): string {
  if (
    specifier === "react" ||
    specifier === "react-dom" ||
    specifier === "react-dom/client"
  ) {
    return specifier;
  }

  const registeredSet =
    registeredModuleIds instanceof Set
      ? registeredModuleIds
      : new Set(registeredModuleIds);

  const resolvedPath = resolveRelativeSpecifier(callerPath, specifier);
  const candidates = getCandidateModuleIds(resolvedPath);

  for (const candidate of candidates) {
    if (registeredSet.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Module not found: ${specifier}`);
}

