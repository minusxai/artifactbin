import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { testDatabase } from "./postgres.js";
import { createInitializer } from "../src/persistence/bootstrap.js";
import { PostgresMigrationDestination } from "../src/migration/postgres.ts";
const pg = createRequire(import.meta.url)("pg");
const preparation = {
  manifest: {
    schemaVersion: 1 as const,
    sourceNamespace: "synthetic",
    exportedAt: "epoch",
    artifacts: [],
    tables: {},
    tokenOwners: [],
  },
  maps: { users: {}, tokens: {}, groups: {}, pages: {} },
};
test("migration runtime DDL uses the app owner while archive and data work retain the restricted migrator", async () => {
  const env = await testDatabase(),
    app = env.schema + "_app",
    migrator = env.schema + "_migrator",
    archive = env.schema + "_migration";
  let appPool: InstanceType<typeof pg.Pool> | undefined,
    migrationPool: InstanceType<typeof pg.Pool> | undefined;
  try {
    for (const role of [app, migrator])
      await env.pool.query(
        `CREATE ROLE "${role}" NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN NOINHERIT`,
      );
    await env.pool.query(
      `GRANT "${app}" TO "${migrator}" WITH INHERIT FALSE, SET TRUE`,
    );
    await env.pool.query(`ALTER SCHEMA "${env.schema}" OWNER TO "${app}"`);
    await env.pool.query(
      `CREATE SCHEMA "${archive}" AUTHORIZATION "${migrator}"`,
    );
    await env.pool.query(
      `GRANT USAGE ON SCHEMA "${env.schema}" TO "${migrator}"`,
    );
    await env.pool.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "${app}" IN SCHEMA "${env.schema}" GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO "${migrator}"`,
    );
    await env.pool.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "${app}" IN SCHEMA "${env.schema}" GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO "${migrator}"`,
    );
    appPool = new pg.Pool({
      connectionString: env.connectionString,
      options: `-c role=${app} -c search_path=${env.schema}`,
    });
    await createInitializer(appPool, env.schema)();
    await assert.rejects(appPool.query(`SELECT * FROM "${archive}".missing`), {
      code: "42501",
    });
    migrationPool = new pg.Pool({
      connectionString: env.connectionString,
      options: `-c role=${migrator} -c search_path=${env.schema}`,
    });
    const client = await migrationPool.connect();
    try {
      const options = {
        schema: env.schema,
        isolated: true,
        origin: "https://example.test",
        editorManageRestricted: true,
      };
      await assert.rejects(
        new PostgresMigrationDestination(client, options).prepare(preparation),
      );
      const failing = {
        query: (sql: string, values?: unknown[]) =>
          client.query(
            sql.startsWith("-- Pagegi v2") ? "SELECT 1/0" : sql,
            values,
          ),
      };
      await assert.rejects(
        new PostgresMigrationDestination(failing, {
          ...options,
          runtimeOwnerRole: app,
        }).prepare(preparation),
        { code: "22012" },
      );
      assert.equal(
        (await client.query("SELECT current_user AS actor")).rows[0].actor,
        migrator,
      );
      await new PostgresMigrationDestination(client, {
        ...options,
        runtimeOwnerRole: app,
      }).prepare(preparation);
      assert.equal(
        (await client.query("SELECT current_user AS actor")).rows[0].actor,
        migrator,
      );
      assert.equal(
        (
          await client.query(
            "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass",
            [env.schema + ".accounts"],
          )
        ).rows[0].owner,
        app,
      );
      assert.equal(
        (
          await client.query(
            "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass",
            [archive + ".archives"],
          )
        ).rows[0].owner,
        migrator,
      );
      assert.equal(
        (
          await client.query(
            "SELECT has_database_privilege(current_user,current_database(),'CREATE') AS allowed",
          )
        ).rows[0].allowed,
        false,
      );
      assert.throws(
        () =>
          new PostgresMigrationDestination(client, {
            ...options,
            runtimeOwnerRole: 'bad";RESET ROLE;--',
          }),
        /runtime owner role/,
      );
    } finally {
      client.release();
    }
  } finally {
    await appPool?.end();
    await migrationPool?.end();
    await env.pool.query(`DROP SCHEMA IF EXISTS "${archive}" CASCADE`);
    // Remove role-scoped default ACLs along with their runtime objects before dropping the roles.
    await env.pool.query(`ALTER SCHEMA "${env.schema}" OWNER TO CURRENT_USER`);
    await env.pool.query(`DROP OWNED BY "${app}" CASCADE`);
    await env.pool.query(`DROP OWNED BY "${migrator}" CASCADE`);
    await env.cleanup();
    const admin = new pg.Pool({ connectionString: env.connectionString });
    try {
      await admin.query(`DROP ROLE IF EXISTS "${migrator}","${app}"`);
    } finally {
      await admin.end();
    }
  }
});
