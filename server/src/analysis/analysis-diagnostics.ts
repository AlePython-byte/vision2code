/** Development-only diagnostics. Callers must supply allowlisted metadata, never raw errors or output. */
export function logAnalysisDiagnostic(event: string, metadata: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "production") return;
  // Observability must not change analysis results if the logging sink fails.
  try { console.info(JSON.stringify({ context: "AnalysisDiagnostic", event, ...metadata })); }
  catch { /* Logging is best effort. */ }
}

export function safeDiagnosticValue(value: unknown, allowed: readonly string[]): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && allowed.includes(value) ? value : "other";
}
