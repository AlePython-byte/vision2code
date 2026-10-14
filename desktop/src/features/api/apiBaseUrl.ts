export const DEFAULT_API_BASE_URL = "http://localhost:3000/api/v1";

export function resolveApiBaseUrl(value?: string): string {
  const url = new URL(value?.trim() || DEFAULT_API_BASE_URL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid API base URL.");
  }
  return url.href.replace(/\/$/, "");
}
