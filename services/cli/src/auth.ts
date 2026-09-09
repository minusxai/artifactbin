import { ApiError } from "./client";
import { normalizeServer, type Connection } from "./config";

export async function ensureConnection(
  saved: Connection | null,
  server: string | undefined,
  flow: {
    validate: (connection: Connection) => Promise<unknown>;
    authenticate: (server: string) => Promise<Connection>;
    notify: (message: string) => void;
  },
): Promise<Connection> {
  if (saved) {
    try {
      await flow.validate(saved);
      return saved;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      flow.notify("Token expired or invalid. Let's sign in again.");
    }
  } else flow.notify("Let's connect your artifactbin account.");
  return flow.authenticate(normalizeServer(server ?? saved?.server ?? process.env.ARTIFACTBIN_URL ?? "https://artifactbin.dev"));
}
