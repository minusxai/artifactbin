/**
 * Account handles (contract: ./handles-contracts.ts): the pure rule, the
 * accounts.handle column (unique; a changed or cleared handle is free at once)
 * and the /api/account/handle routes.
 */
import { fail } from "../errors.ts";
import type { SqlClient, SqlDatabase } from "../backend/af-backend-contracts.ts";
import type { AfRouteModule } from "./af-api-contracts.ts";
import {
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_PATTERN,
  RESERVED_HANDLES,
  type HandleProblem,
  type HandleStore,
} from "./handles-contracts.ts";

const ROUTE = "/api/account/handle";
const PROBLEMS: Record<HandleProblem, string> = {
  length: `A handle is ${HANDLE_MIN} to ${HANDLE_MAX} characters`,
  characters: "A handle uses lowercase letters, digits, underscores and single inner hyphens",
  reserved: "That handle is reserved; choose another",
};

export function normalizeHandle(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function handleProblem(normalized: string): HandleProblem | null {
  if (normalized.length < HANDLE_MIN || normalized.length > HANDLE_MAX) return "length";
  if (!HANDLE_PATTERN.test(normalized)) return "characters";
  if (RESERVED_HANDLES.has(normalized)) return "reserved";
  return null;
}

export const handleStore: HandleStore = {
  async read(client, actor) {
    const row = (await client.query("SELECT handle FROM accounts WHERE actor=$1", [actor])).rows[0];
    return typeof row?.handle === "string" ? row.handle : null;
  },
  async set(client, actor, value) {
    const handle = normalizeHandle(value);
    const problem = handleProblem(handle);
    if (problem) fail(422, PROBLEMS[problem]);
    const holder = (await client.query("SELECT actor FROM accounts WHERE handle=$1", [handle])).rows[0];
    if (holder && holder.actor !== actor) fail(409, "That handle is taken");
    try {
      await client.query("UPDATE accounts SET handle=$2 WHERE actor=$1", [actor, handle]);
    } catch (error) {
      // Another account saved it between the check and the write.
      if (error && typeof error === "object" && "code" in error && error.code === "23505") fail(409, "That handle is taken");
      throw error;
    }
    return handle;
  },
  async clear(client, actor) {
    await client.query("UPDATE accounts SET handle=NULL WHERE actor=$1", [actor]);
  },
  async actor(client, value) {
    const handle = normalizeHandle(value);
    if (handleProblem(handle) === "length" || !HANDLE_PATTERN.test(handle)) return null;
    const row = (await client.query("SELECT actor FROM accounts WHERE handle=$1", [handle])).rows[0];
    return typeof row?.actor === "string" ? row.actor : null;
  },
};

const reply = (status: number, body: unknown) => ({ status, body });

export function createHandleRoutes(options: {
  database: SqlDatabase;
  actor(credential: string): Promise<string>;
}): AfRouteModule {
  const { database, actor } = options;
  return {
    async handle(request) {
      if (request.url.pathname !== ROUTE) return null;
      const method = request.method;
      if (method !== "GET" && method !== "PUT" && method !== "DELETE")
        return reply(405, { error: "Use GET, PUT or DELETE for this route" });
      const who = await actor(request.credential);
      return database.transaction(async (client: SqlClient) => {
        if (method === "GET") return reply(200, { handle: await handleStore.read(client, who) });
        if (method === "PUT") return reply(200, { handle: await handleStore.set(client, who, request.body?.handle) });
        await handleStore.clear(client, who);
        return reply(200, { handle: null });
      });
    },
  };
}
