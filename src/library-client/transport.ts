import type { CreateLibraryTransport } from "./contracts.ts";
/** The one sentence for any failure to get an answer from this server. */
export const UNREACHABLE =
  "Could not reach Pagegi. Check your connection and try again.";
export const createLibraryTransport: CreateLibraryTransport =
  (fetcher, timeoutMs = 15000) =>
  async (path, body, signal, token, method) => {
    let response: Response | undefined, value: unknown;
    try {
      response = await fetcher(path, {
        method: method || (body ? "POST" : "GET"),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        headers: {
          "Content-Type": "application/json",
          "X-Pagegi-Home": "1",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      value = await response.json();
    } catch (error) {
      if (signal.aborted) throw error;
      throw Object.assign(Error(UNREACHABLE), { status: response?.status });
    }
    if (!response.ok) {
      const error = (value as { error?: unknown } | null)?.error;
      throw Object.assign(
        Error(typeof error === "string" && error ? error : UNREACHABLE),
        { status: response.status },
      );
    }
    return value;
  };
