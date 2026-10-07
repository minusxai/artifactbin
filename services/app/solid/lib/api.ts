/**
 * The app's mutation transport: same-origin credentials, JSON bodies, one error mapping. Pages keep
 * their own user-facing messages and decide what a failure says; this owns only how the request is sent.
 */
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A failed request: `status` is the HTTP status, `message` the server's own explanation when it gave one. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** `fetch` with the app's defaults: same-origin credentials and, when `json` is given, a JSON body. */
export function apiFetch(url: string, method: Method = 'GET', json?: unknown, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    method,
    credentials: 'same-origin',
    ...(json === undefined ? {} : { headers: { 'Content-Type': 'application/json', ...init?.headers }, body: JSON.stringify(json) }),
  });
}

/** Send and parse JSON; refusals preserve the server's explanation and HTTP status. */
export async function apiRequest<T>(url: string, method: Method = 'GET', json?: unknown, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, method, json, init);
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = [...(Array.isArray(data?.details) ? data.details : []), data?.detail, data?.message, data?.error]
      .find((value): value is string => typeof value === 'string' && !!value.trim());
    throw new ApiError(message ?? 'The request failed.', response.status);
  }
  return data as T;
}
