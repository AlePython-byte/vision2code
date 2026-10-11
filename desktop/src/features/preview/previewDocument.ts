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
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none';";

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
    options.script,
    "  </script>",
    "</body>",
    "</html>",
  ].join("\n");
}
