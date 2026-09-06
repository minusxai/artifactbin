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
  const result = (await response.json()) as { error?: string };
  if (!response.ok)
    throw new ApiError(
      result.error ?? `Server returned ${response.status}`,
      response.status,
    );
  return result as T;
}
