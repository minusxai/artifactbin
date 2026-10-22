import test from "node:test";
import assert from "node:assert/strict";
import { prepareSourceSql } from "../src/datasets/source-query/sql.ts";
import { createSourceQueryService } from "../src/datasets/source-query/service.ts";
import { createHash } from "node:crypto";
const sql = "SELECT $needle AS value";
const registration = {
  pageLegacyId: "legacy",
  pageVersion: 1,
  name: "answer",
  sourceRef: "ref:ABC123",
  resource: "source-ABC123",
  sql,
  sqlSha256: createHash("sha256").update(sql).digest("hex"),
  params: { needle: "string" as const },
  columns: [{ name: "value", type: "string" as const }],
  backendId: "BACK01",
  backendVersion: "1",
  pageId: "PAGE01",
  sourceNamespace: "test",
};
const context = {
  backendId: "BACK01",
  backendVersion: "1",
  pageId: "PAGE01",
  subject: "user:test",
};
test("source SQL parameters skip comments literals dollar strings and normalize viewer", () => {
  assert.deepEqual(
    prepareSourceSql(
      `select $needle, $_me.id, '$ignored', $$ $ignored $$ /* $ignored */`,
    ),
    {
      text: `select $1, $2, '$ignored', $$ $ignored $$ /* $ignored */`,
      names: ["needle", "_me__id"],
    },
  );
});
test("source query derives named SQL server-side, brackets access, refuses injected authority", async () => {
  const calls: any[] = [];
  let auth = 0;
  const pool = {
    connect: async () => ({
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return {
          rows: text.startsWith("SELECT * FROM") ? [{ value: "hello" }] : [],
        };
      },
      release() {},
    }),
    end: async () => {},
  };
  const service = createSourceQueryService({
    registry: async () => registration,
    authority: async () => {
      auth++;
      return {
        generation: "stable",
        userId: "old-user",
        now: "2026-01-01T00:00:00Z",
        tz: "UTC",
      };
    },
    pool: () => pool,
  });
  const result = await service.query(context, {
    name: "answer",
    valuesJson: '{"needle":"hello"}',
    offset: 0,
    limit: 10,
  });
  assert.equal(result.rows[0]?.value, "hello");
  assert.equal(auth, 2);
  assert.equal(calls[0].text, "BEGIN READ ONLY");
  assert.ok(
    calls.find(
      (c) => c.text.startsWith("SELECT * FROM") && c.values[0] === "hello",
    ),
  );
  for (const input of [
    { name: "answer", valuesJson: '{"_now":"evil"}', offset: 0, limit: 10 },
    { name: "answer", valuesJson: "{}", offset: 0, limit: 10, sql: "delete" },
    { name: "constructor", valuesJson: "{}", offset: 0, limit: 10 },
  ])
    await assert.rejects(service.query(context, input));
});
import { createSourceQueryResources } from "../src/datasets/source-query/resources.ts";
test("operator source resources enforce CA verification and read-only defaults despite URL SSL overrides", async () => {
  let options: any;
  let ended = 0;
  const resources = createSourceQueryResources(
    JSON.stringify({
      resources: {
        "source-ABC123": {
          connectionStringEnv: "PAGEGI_SOURCE_QUERY_TEST_URL",
          caEnv: "PAGEGI_SOURCE_QUERY_TEST_CA",
        },
      },
    }),
    {
      PAGEGI_SOURCE_QUERY_TEST_URL:
        "postgres://reader:private@db.invalid/source?sslmode=no-verify&sslrootcert=bad",
      PAGEGI_SOURCE_QUERY_TEST_CA: "public-ca",
    },
    (o) => {
      options = o;
      return {
        connect: async () => {
          throw Error("unused");
        },
        end: async () => {
          ended++;
        },
        on() {},
      };
    },
  );
  assert.equal(
    new URL(options.connectionString).searchParams.has("sslmode"),
    false,
  );
  assert.deepEqual(options.ssl, { ca: "public-ca", rejectUnauthorized: true });
  assert.equal(options.options, "-c default_transaction_read_only=on");
  assert.equal(resources.pool("unknown"), undefined);
  await resources.close();
  await resources.close();
  assert.equal(ended, 1);
  assert.throws(
    () =>
      createSourceQueryResources(
        JSON.stringify({
          resources: {
            "source-ABC123": {
              connectionStringEnv: "DATABASE_URL",
              caEnv: "PAGEGI_SOURCE_QUERY_TEST_CA",
            },
          },
        }),
        {},
      ),
    /Invalid source query resources/,
  );
});
