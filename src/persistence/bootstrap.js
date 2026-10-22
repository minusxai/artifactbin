// @ts-check
import { existsSync, readFileSync } from "node:fs";
import { createSqlDatabase } from "./sql.ts";
const schemaSQL = readFileSync(
  new URL("../schema.sql", import.meta.url),
  "utf8",
);
/** Brief C's tables (BACKEND_SCHEMA_FILE) run after ours when that file exists. */
const backendSchema = new URL("../backend/af-schema.sql", import.meta.url);
const datasetSchema = new URL("../datasets/schema.sql", import.meta.url);
/**
 * Creates the configured schema when it is missing, then the tables in it.
 * @param {import('./sql.ts').SqlPool} pool
 * @param {string} [schema] already validated as a plain identifier
 * @returns {()=>Promise<void>} */
export function createInitializer(pool, schema = "public") {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw Error("Invalid database schema");
  const startup = createSqlDatabase({
    pool,
    initialize: async () => {},
    statementTimeoutMs: 15000,
    lockTimeoutMs: 5000,
  });
  /** @type {Promise<void>|undefined} */
  let ready;
  return () =>
    (ready ||= startup
      .transaction(async (c) => {
        // Without it, the search path would fall back to public.
        await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':pagegi-schema',0))",
        );
        await c.query(schemaSQL);
        if (existsSync(backendSchema))
          await c.query(readFileSync(backendSchema, "utf8"));
        if (existsSync(datasetSchema))
          await c.query(readFileSync(datasetSchema, "utf8"));
      })
      .catch((error) => {
        ready = undefined;
        throw error;
      }));
}
