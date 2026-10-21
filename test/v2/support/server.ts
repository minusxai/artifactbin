/**
 * A disposable v2 server on a loopback port with its own Postgres schema.
 * Used by database, isolate and browser acceptance tests.
 */
import type {
  AfServerModule,
  AfServiceOptions,
  TokenResponse,
} from "../../../src/server/af-api-contracts.ts";
import { testDatabase } from "../../postgres.js";
import { load } from "./load.ts";

export interface TestServer {
  origin: string;
  /** The disposable database the server runs in, for tests that connect a resource to it. */
  connectionString: string;
  schema: string;
  /** A fresh account token through POST /api/auth/test-token. */
  token(email?: string): Promise<string>;
  /** fetch against the server with optional bearer token and JSON body. */
  request(
    path: string,
    init?: {
      method?: string;
      token?: string;
      body?: unknown;
      headers?: Record<string, string>;
    },
  ): Promise<Response>;
  /** SQL in the server's own schema, for tests that inject a storage failure. */
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  /** A dedicated connection in the server's schema, for tests that hold a transaction across requests. */
  connect(): Promise<{
    query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    release(): void;
  }>;
  close(): Promise<void>;
}

export async function startServer(
  options: Omit<AfServiceOptions, "connectionString" | "schema"> = {},
  /** SQL to run in the empty schema before the server starts, for tests that begin from an older database. */
  before?: (query: (sql: string) => Promise<unknown>) => Promise<void>,
): Promise<TestServer> {
  const db = await testDatabase();
  let service;
  try {
    await before?.((sql) => db.pool.query(sql));
    const { createService } = await load<AfServerModule>("src/server.js");
    service = createService({
      connectionString: db.connectionString,
      schema: db.schema,
      testLogin: true,
      ...options,
    });
    await new Promise<void>((resolve) =>
      service!.server.listen(0, "127.0.0.1", resolve),
    );
  } catch (error) {
    await service?.close().catch(() => {});
    await db.cleanup();
    throw error;
  }
  const port = (service.server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  let accounts = 0;
  const request: TestServer["request"] = (path, init = {}) =>
    fetch(origin + path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  return {
    origin,
    connectionString: db.connectionString,
    schema: db.schema,
    request,
    query: (sql, params = []) => db.pool.query(sql, params),
    connect: () => db.pool.connect(),
    async token(email = `agent${++accounts}@example.test`) {
      const response = await request("/api/auth/test-token", {
        body: { email },
      });
      if (response.status !== 200)
        throw Error(`test-token returned ${response.status}`);
      return ((await response.json()) as TokenResponse).token;
    },
    async close() {
      service.server.closeAllConnections();
      await new Promise<void>((resolve) => service.server.close(() => resolve()));
      await service.close();
      await db.cleanup();
    },
  };
}

/** A page source with `marker` in its body, using the default host. */
export function page(body: string, head = ""): string {
  return `<!DOCTYPE html>
<html>
<head>
  <script src="https://artifactbin.dev/af/v1/core.js"></script>
  <title>Test page</title>
${head}</head>
<body>
${body}
</body>
</html>
`;
}
