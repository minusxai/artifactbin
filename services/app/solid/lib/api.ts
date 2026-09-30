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

/** Send and parse the JSON answer; a non-2xx answer throws an ApiError carrying the server's `details[0]` or `error`. */
export async function apiRequest<T>(url: string, method: Method = 'GET', json?: unknown, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, method, json, init);
  const data = await response.json().catch(() => ({})) as { details?: string[]; error?: string };
  if (!response.ok) throw new ApiError(data.details?.[0] ?? data.error ?? 'The request failed.', response.status);
  return data as T;
}
