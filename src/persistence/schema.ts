import type { SchemaQuery } from "./schema-contracts.ts";
/** Existing private namespaces need schema privileges, never database-wide CREATE. */
export async function ensureSchema(
  db: SchemaQuery,
  name: string,
): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name))
    throw Error("Invalid database schema");
  const existing = (
    await db.query(
      "SELECT has_schema_privilege(oid,'USAGE') AS usable, has_schema_privilege(oid,'CREATE') AS writable FROM pg_catalog.pg_namespace WHERE nspname=$1",
      [name],
    )
  ).rows[0];
  if (existing) {
    if (existing.usable !== true || existing.writable !== true)
      throw Error(
        "Configured database schema requires USAGE and CREATE privileges",
      );
    return;
  }
  // Names are bounded plain identifiers and always quoted. This path intentionally needs database CREATE.
  await db.query(`CREATE SCHEMA IF NOT EXISTS "${name}"`);
}
