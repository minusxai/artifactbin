import { namespaceLibraryPath } from "./namespace.ts";
import type {
  LibrarySession,
  LibrarySessionOptions,
  LibrarySnapshot,
  LibraryData,
  LibraryProfile,
} from "./contracts.ts";
export function createLibrarySession(
  options: LibrarySessionOptions,
): LibrarySession {
  let owner = options.owner;
  let epoch = 0,
    disposed = false,
    credential: string | null = null,
    assumeSignedOut = options.signedOut === true;
  let snapshot: LibrarySnapshot = { status: "pending" };
  const getSnapshot = () => structuredClone(snapshot);
  function publish(next: LibrarySnapshot) {
    snapshot = structuredClone(next);
    options.changed(getSnapshot());
  }
  const pending = new Set<AbortController>();
  function invalidate() {
    epoch++;
    for (const c of pending) c.abort();
    pending.clear();
  }
  async function request<T = unknown>(
    path: string,
    body?: unknown,
    method?: string,
  ): Promise<T> {
    if (disposed) throw Error("Library session is closed.");
    const version = epoch;
    const controller = new AbortController();
    pending.add(controller);
    try {
      const result = (await options.request(
        path,
        body,
        controller.signal,
        credential,
        method,
      )) as T;
      if (!current(version)) throw Error("Library request superseded.");
      return result;
    } finally {
      pending.delete(controller);
    }
  }
  const current = (version: number) => !disposed && version === epoch;
  return {
    request,
    getSnapshot,
    token: () => credential,
    cancelAuthentication: invalidate,
    async load() {
      if (disposed) return;
      invalidate();
      if (assumeSignedOut) {
        // Signing in later loads again, and that load asks the server.
        assumeSignedOut = false;
        publish({ status: "signed-out", error: "" });
        return getSnapshot();
      }
      const version = epoch;
      publish({ status: "pending" });
      let snapshot: LibrarySnapshot;
      try {
        const [data, profile] = await Promise.all([
          request<LibraryData>(
            options.embedded
              ? "/api/library/session"
              : namespaceLibraryPath("/api/library", owner),
          ),
          options.sharing
            ? Promise.resolve({ name: "", image: null })
            : request<LibraryProfile>("/api/library/profile"),
        ]);
        snapshot = { status: "signed-in", data, profile };
      } catch (error) {
        snapshot = {
          status:
            (error as { status?: number })?.status === 401
              ? "signed-out"
              : "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (!current(version)) return;
      publish(snapshot);
      return getSnapshot();
    },
    async verify(email, code) {
      if (disposed) return false;
      invalidate();
      const version = epoch;
      try {
        const verified = await request<{ token: string }>(
          "/api/auth/email/verify",
          { email, code, browserSession: !options.embedded },
        );
        if (!current(version)) return false;
        if (options.embedded) credential = verified.token;
      } catch (error) {
        if (!current(version)) return false;
        throw error;
      }
      return true;
    },
    async logout() {
      if (disposed) return false;
      invalidate();
      const version = epoch;
      await request("/api/library/logout", {});
      if (!current(version)) return false;
      credential = null;
      owner = undefined;
      publish({ status: "signed-out", error: "" });
      return true;
    },
    dispose() {
      disposed = true;
      invalidate();
      credential = null;
    },
  };
}
