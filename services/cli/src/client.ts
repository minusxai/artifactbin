import type { Connection } from "./config";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  connection: Connection,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    `${connection.server}/api/remote/sessions${path}`,
    {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${connection.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok)
    throw new ApiError(
      typeof result?.error === 'string' ? result.error : `Server returned HTTP ${response.status} ${response.statusText}. Check the server logs.`,
      response.status,
    );
  if (result === null)
    throw new ApiError('Server returned an invalid JSON response. Check the server URL and logs.', response.status);
  return result as T;
}
