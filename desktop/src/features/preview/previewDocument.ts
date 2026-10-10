/**
 * Sandbox attribute for the preview frame. The empty string applies EVERY restriction:
 * no scripts, no same-origin access, no forms, no popups, no top navigation.
 * The next checkpoint may add only script execution, and must never grant same-origin access.
 */
export const PREVIEW_SANDBOX = "";

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
