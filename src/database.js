import pg from "pg";
import { createSqlDatabase } from "./persistence/sql.ts";
import { createInitializer } from "./persistence/bootstrap.js";
import { createDocumentCatalog } from "./persistence/document-catalog.js";
import { createPathCatalog } from "./persistence/path-catalog.js";
import { createIdentityRepository } from "./persistence/identity-repository.ts";
import { createCollaborationRepository } from "./persistence/collaboration.ts";
import { createCommentRepository } from "./server/comment-repository.ts";
/** One pool composes semantic repositories; generic projected state is not exposed.
 * @param {{connectionString?: string, schema?: string, now?: () => number}} options
 * @returns {import('./persistence/database-contracts.ts').DatabaseRepository & {sql: import('./persistence/sql.ts').SqlDatabase}} `sql` serves the v2 page services and brief C's backend files.
 */
export function database({
  connectionString,
  schema = "public",
  now = Date.now,
} = {}) {
  if (!connectionString) throw Error("PAGEGI_DATABASE_URL is required");
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw Error("Invalid database schema");
  const pool = new pg.Pool({
    connectionString,
    options: `-c search_path=${schema},public`,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", () =>
    console.error("Postgres connection lost; reconnecting on next request"),
  );
  const initialize = createInitializer(pool, schema);
  const sql = createSqlDatabase({
    pool,
    initialize,
    statementTimeoutMs: 15000,
    lockTimeoutMs: 5000,
  });
  const catalog = createDocumentCatalog(sql),
    paths = createPathCatalog(sql);
  const collaboration = createCollaborationRepository(sql, {
    profiles: catalog.profiles,
    sharedLink: catalog.sharedLink,
  });
  return {
    sql,
    catalog,
    paths,
    health: () =>
      sql.transaction(async (client) => {
        await client.query("SELECT 1");
      }),
    identity: createIdentityRepository(sql),
    collaboration,
    comments: createCommentRepository(sql),
    close: () => pool.end(),
  };
}
