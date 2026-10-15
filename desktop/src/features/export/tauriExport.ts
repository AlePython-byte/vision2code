import { z } from "zod";
import type { NativeExport, NativeExportResult } from "./exportModel.ts";

const ResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("EXPORTED"), folderName: z.string().min(1).max(200), fileCount: z.number().int().nonnegative() }),
  z.strictObject({ status: z.literal("CANCELLED") }),
  z.strictObject({ status: z.literal("FAILED"), code: z.enum([
    "NO_FILES", "INVALID_PATH", "PATH_TOO_LONG", "DUPLICATE_PATH", "INVALID_CONTENT",
    "TOO_MANY_FILES", "TOO_LARGE", "DESTINATION_INVALID", "PERMISSION_DENIED", "IO_ERROR",
  ]) }),
]);

type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/** True inside the Tauri webview (the browser dev shell has no native runtime). */
export function hasNativeRuntime(scope: object = globalThis): boolean {
  return "__TAURI_INTERNALS__" in scope;
}

/**
 * Calls the single native `export_project` command. Only relative paths, text and a suggested
 * name are sent; the folder is picked in a native dialog inside Rust, so no path crosses the bridge.
 * Anything unexpected from the native side becomes a stable FAILED code.
 */
export function createTauriExport(
  invoke: Invoke | null = null,
  available: () => boolean = () => hasNativeRuntime(),
): NativeExport {
  return async ({ files, suggestedName }): Promise<NativeExportResult> => {
    if (!invoke && !available()) return { status: "FAILED", code: "UNAVAILABLE" };
    const call: Invoke = invoke ?? (await import("@tauri-apps/api/core")).invoke;
    let raw: unknown;
    try {
      raw = await call("export_project", { files: files.map(({ path, content }) => ({ path, content })), suggestedName });
    } catch {
      return { status: "FAILED", code: "IO_ERROR" };
    }
    const parsed = ResultSchema.safeParse(raw);
    return parsed.success ? parsed.data : { status: "FAILED", code: "IO_ERROR" };
  };
}
