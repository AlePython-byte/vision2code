import { PREVIEW_RUNTIME_SOURCE } from "./runtime/previewRuntime.ts";

/**
 * Sandbox attribute for the preview frame.
 * Only allows script execution within the isolated frame.
 * Does NOT permit same-origin, forms, popups, top-navigation, or modals.
 */
export const PREVIEW_SANDBOX = "allow-scripts";

/**
 * Restrictive Content Security Policy for the preview iframe document.
 * Blocks all external network traffic and remote scripts.
 */
export const PREVIEW_IFRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

/**
 * Inside Tauri the preview frame is NOT a srcdoc: a srcdoc (or blob:) document inherits the app's CSP, whose script-src
 * has hashes and no 'unsafe-inline', so the generated code never ran in the packaged app. The frame loads the app's own
 * preview origin instead (Rust scheme `v2cpreview`, desktop/src-tauri/src/preview.rs), which carries the policy above as
 * a header and receives the document through postMessage. A plain browser (`npm run dev`, no app CSP) keeps srcdoc.
 */
export const PREVIEW_SCHEME = "v2cpreview";
export const PREVIEW_MESSAGE_SOURCE = "v2c-preview";
export const PREVIEW_HOST_SOURCE = "v2c-host";
/** If the frame has not said "started" by then, the panel shows an error instead of an empty canvas marked active. */
export const PREVIEW_START_TIMEOUT_MS = 8000;

export function previewFrameUrl(host: { readonly navigator?: { readonly userAgent?: string } } | undefined): string | null {
  if (!host || !("__TAURI_INTERNALS__" in host)) return null;
  // Windows and Android expose custom schemes as http://<scheme>.localhost; macOS and Linux as <scheme>://localhost.
  return /Windows|Android/i.test(host.navigator?.userAgent ?? "") ? `http://${PREVIEW_SCHEME}.localhost/` : `${PREVIEW_SCHEME}://localhost/`;
}

export type PreviewFrameStatus = "LOADING" | "STARTED" | "FAILED";

export interface PreviewHandshake {
  /** Feed every window "message" event; only those whose source is the current frame window count. */
  receive(event: { readonly source: unknown; readonly data: unknown }): void;
  dispose(): void;
}

/**
 * Host side of the frame protocol. "ready" (scheme mode only) asks for the document; "started" is sent by the runtime once
 * the document's scripts run. No "started" within the timeout means the scripts never ran (for example, blocked by a CSP).
 */
export function createPreviewHandshake(options: {
  readonly frameWindow: () => unknown;
  readonly deliver?: (() => void) | undefined;
  readonly onStatus: (status: PreviewFrameStatus) => void;
  readonly timeoutMs?: number | undefined;
  readonly schedule?: ((callback: () => void, ms: number) => unknown) | undefined;
  readonly cancel?: ((handle: unknown) => void) | undefined;
}): PreviewHandshake {
  const schedule = options.schedule ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const cancel = options.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let disposed = false;
  let timer: unknown = schedule(() => { timer = null; if (!disposed) options.onStatus("FAILED"); }, options.timeoutMs ?? PREVIEW_START_TIMEOUT_MS);
  options.onStatus("LOADING");
  return {
    receive(event) {
      if (disposed || event.source === null || event.source === undefined || event.source !== options.frameWindow()) return;
      const data = event.data as { source?: unknown; type?: unknown } | null;
      if (!data || typeof data !== "object" || data.source !== PREVIEW_MESSAGE_SOURCE) return;
      if (data.type === "ready") options.deliver?.();
      if (data.type === "started") {
        if (timer !== null) { cancel(timer); timer = null; }
        options.onStatus("STARTED");
      }
    },
    dispose() {
      disposed = true;
      if (timer !== null) { cancel(timer); timer = null; }
    },
  };
}

/** Runs right after the runtime: proves to the host that the document's scripts execute. */
export const PREVIEW_STARTED_SIGNAL =
  'try { parent.postMessage({ source: "v2c-preview", type: "started" }, "*"); } catch (error) { /* no host */ }';

/**
 * Static placeholder document: contains no text, no script and no project data,
 * so it is theme-agnostic and cannot execute anything.
 */
export const PREVIEW_PLACEHOLDER_DOCUMENT =
  "<!doctype html><html><head><meta charset=\"utf-8\"><style>" +
  "html,body{height:100%;margin:0;background:transparent}" +
  "body{background-image:linear-gradient(#80808026 1px,transparent 1px),linear-gradient(90deg,#80808026 1px,transparent 1px);" +
  "background-size:24px 24px}" +
  "</style></head><body></body></html>";

export interface BuildPreviewDocumentOptions {
  readonly css: string;
  readonly script: string;
}

/**
 * Assembles a fully standalone HTML document for the sandboxed preview iframe.
 * Contains inline preflight & Tailwind CSS, micro React runtime, and compiled project code.
 */
export function buildPreviewDocument(options: BuildPreviewDocumentOptions): string {
  return [
    "<!doctype html>",
    '<html lang="es">',
    "<head>",
    '  <meta charset="utf-8">',
    `  <meta http-equiv="Content-Security-Policy" content="${PREVIEW_IFRAME_CSP}">`,
    "  <style>",
    "    html, body {",
    "      margin: 0;",
    "      padding: 0;",
    "      width: 100%;",
    "      height: 100%;",
    "      min-height: 100%;",
    "      box-sizing: border-box;",
    "      background-color: #f1f5f9;",
    "      background-image:",
    "        linear-gradient(rgba(148, 163, 184, 0.25) 1px, transparent 1px),",
    "        linear-gradient(90deg, rgba(148, 163, 184, 0.25) 1px, transparent 1px);",
    "      background-size: 20px 20px;",
    "      overflow: auto;",
    "    }",
    "    #preview-stage {",
    "      display: flex;",
    "      align-items: center;",
    "      justify-content: center;",
    "      min-width: 100%;",
    "      min-height: 100%;",
    "      padding: 16px;",
    "      box-sizing: border-box;",
    "    }",
    "    #preview-viewport-shell {",
    "      position: relative;",
    "      flex-shrink: 0;",
    "      display: block;",
    "      margin: auto;",
    "      transition: width 120ms ease-out, height 120ms ease-out;",
    "    }",
    "    #preview-scaled-canvas {",
    "      position: absolute;",
    "      top: 0;",
    "      left: 0;",
    "      transform-origin: 0 0;",
    "      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.15), 0 4px 6px -4px rgba(15, 23, 42, 0.1);",
    "      border-radius: 8px;",
    "      background-color: #ffffff;",
    "      transition: transform 120ms ease-out;",
    "    }",
    options.css,
    "  </style>",
    "</head>",
    "<body>",
    '  <div id="preview-stage">',
    '    <div id="preview-viewport-shell">',
    '      <div id="preview-scaled-canvas">',
    '        <div id="root"></div>',
    "      </div>",
    "    </div>",
    "  </div>",
    "  <script>",
    PREVIEW_RUNTIME_SOURCE,
    "  </script>",
    "  <script>",
    PREVIEW_STARTED_SIGNAL,
    "  </script>",
    "  <script>",
    options.script,
    "  </script>",
    "</body>",
    "</html>",
  ].join("\n");
}
