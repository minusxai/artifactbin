import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const pg = createRequire(import.meta.url)("pg");
import { testDatabase } from "./postgres.js";
import { ensureSchema } from "../src/persistence/schema.ts";
import { createInitializer } from "../src/persistence/bootstrap.js";
import { PostgresMigrationDestination } from "../src/migration/postgres.ts";
import { PostgresStreamArchive } from "../src/migration/stream-postgres.ts";
test("a schema-only role initializes and prepares existing isolated namespaces without database CREATE", async () => {
  const env = await testDatabase(),
    role = env.schema + "_role",
    archive = env.schema + "_migration",
    old = env.schema + "_old";
  let restricted: InstanceType<typeof pg.Pool> | undefined;
  try {
    await env.pool.query(
      `CREATE ROLE "${role}" NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN`,
    );
    await env.pool.query(`ALTER SCHEMA "${env.schema}" OWNER TO "${role}"`);
    await env.pool.query(`CREATE SCHEMA "${archive}" AUTHORIZATION "${role}"`);
    await env.pool.query(`CREATE SCHEMA "${old}"`);
    await env.pool.query(`CREATE TABLE "${old}".private_data(value text)`);
    restricted = new pg.Pool({
      connectionString: env.connectionString,
      options: `-c role=${role} -c search_path=${env.schema}`,
    });
    const privilege = await restricted.query(
      "SELECT has_database_privilege(current_user,current_database(),'CREATE') AS allowed",
    );
    assert.equal(privilege.rows[0]!.allowed, false);
    await createInitializer(restricted, env.schema)();
    assert.equal(
      (await restricted.query("SELECT count(*)::int AS n FROM accounts"))
        .rows[0]!.n,
      0,
    );
    const client = await restricted.connect();
    try {
      const destination = new PostgresMigrationDestination(client, {
        schema: env.schema,
        isolated: true,
        origin: "https://example.test",
        editorManageRestricted: true,
      });
      await destination.prepare({
        manifest: {
          schemaVersion: 1,
          sourceNamespace: "synthetic",
          exportedAt: "epoch",
          artifacts: [],
          tables: {},
          tokenOwners: [],
        },
        maps: { users: {}, tokens: {}, groups: {}, pages: {} },
      });
      const stream = new PostgresStreamArchive(client, env.schema, true);
      await stream.initialize();
    } finally {
      client.release();
    }
    await assert.rejects(
      ensureSchema(restricted, old),
      /requires USAGE and CREATE/,
    );
    await assert.rejects(
      createInitializer(restricted, env.schema + "_missing")(),
      { code: "42501" },
    );
    await assert.rejects(
      restricted.query(`CREATE SCHEMA "${env.schema}_forbidden"`),
      { code: "42501" },
    );
    await assert.rejects(
      restricted.query(`SELECT * FROM "${old}".private_data`),
      { code: "42501" },
    );
  } finally {
    await restricted?.end();
    await env.pool.query(`DROP SCHEMA IF EXISTS "${archive}" CASCADE`);
    await env.pool.query(`DROP SCHEMA IF EXISTS "${old}" CASCADE`);
    await env.cleanup();
    const admin = new pg.Pool({ connectionString: env.connectionString });
    try {
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.end();
    }
  }
});

test("local provisioning still creates a missing schema when database CREATE is authorized", async () => {
  const env = await testDatabase(),
    target = env.schema + "_new";
  try {
    await ensureSchema(env.pool, target);
    assert.equal(
      (
        await env.pool.query(
          "SELECT count(*)::int AS n FROM pg_catalog.pg_namespace WHERE nspname=$1",
          [target],
        )
      ).rows[0]!.n,
      1,
    );
  } finally {
    await env.pool.query(`DROP SCHEMA IF EXISTS "${target}"`);
    await env.cleanup();
  }
});
