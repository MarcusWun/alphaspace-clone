/**
 * Lightweight fetch wrapper for Alpha API calls.
 * All requests go through the Next.js rewrite proxy to the Fastify API.
 */

export class ApiError extends Error {
  statusCode: number;
  code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    let code: string | undefined;
    try {
      const body = await res.json() as { error?: string; code?: string };
      if (body.error) message = body.error;
      code = body.code;
    } catch {
      // ignore JSON parse failure
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      const hint = retryAfter ? ` Retry after ${retryAfter}s.` : "";
      throw new ApiError(`Rate limit exceeded.${hint}`, 429, code ?? "RATE_LIMITED");
    }

    throw new ApiError(message, res.status, code);
  }

  return res.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: (path: string) => apiFetch<void>(path, { method: "DELETE" }),
};
