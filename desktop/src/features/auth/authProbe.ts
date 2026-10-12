import { resolveApiBaseUrl } from "../analysis/analysisClient.ts";

export interface ProbeResult {
  readonly ok: boolean;
  readonly status: number;
  readonly user?: { id: string; email?: string | undefined };
  readonly isUnauthorized: boolean;
}

/**
 * Lightweight diagnostic probe against GET /api/v1/auth/me.
 * Validates that an established client session is accepted by the NestJS server.
 *
 * Security:
 * - Access token is fetched out-of-band via getAccessToken().
 * - Token is NEVER stored in React state, localStorage, or logged.
 * - Non-blocking: failures during development or backend downtime do NOT freeze the UI.
 * - If status is 401, isUnauthorized is returned so the caller can trigger session expiration.
 */
export async function probeBackendAuth(
  getAccessToken: () => Promise<string | null>,
  baseUrl?: string,
  transport: typeof fetch = globalThis.fetch
): Promise<ProbeResult> {
  let token: string | null = null;
  try {
    token = await getAccessToken();
  } catch {
    return { ok: false, status: 0, isUnauthorized: false };
  }

  if (!token) {
    return { ok: false, status: 401, isUnauthorized: true };
  }

  let endpoint: string;
  try {
    endpoint = resolveApiBaseUrl(baseUrl);
  } catch {
    return { ok: false, status: 0, isUnauthorized: false };
  }

  try {
    const response = await transport(`${endpoint}/auth/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 401) {
      return { ok: false, status: 401, isUnauthorized: true };
    }

    if (response.ok) {
      const data = await response.json();
      return {
        ok: true,
        status: response.status,
        user: data?.user,
        isUnauthorized: false,
      };
    }

    return { ok: false, status: response.status, isUnauthorized: false };
  } catch {
    // Network errors or backend offline should not crash the client
    return { ok: false, status: 0, isUnauthorized: false };
  }
}

