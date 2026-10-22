import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { testDatabase } from "./postgres.js";
import { createSourceQueryService } from "../src/datasets/source-query/service.ts";
test("external source runs named typed parameters read-only and discards revoked results", async () => {
  const db = await testDatabase();
  try {
    await db.pool.query(
      "CREATE TABLE items(value text); INSERT INTO items VALUES('original')",
    );
    const context = {
      backendId: "BACK01",
      backendVersion: "1",
      pageId: "PAGE01",
      subject: "user:test",
    };
    const definition = {
      pageLegacyId: "legacy",
      pageVersion: 1,
      name: "answer",
      sourceRef: "ref:ABC123",
      resource: "source-ABC123",
      params: { needle: "string" as const, _me__id: "user" as const },
      columns: [{ name: "value", type: "string" as const }],
      backendId: "BACK01",
      backendVersion: "1",
      pageId: "PAGE01",
      sourceNamespace: "test",
      sql: "SELECT $needle::text || $_me.id::text AS value",
      sqlSha256: "",
    };
    definition.sqlSha256 = createHash("sha256")
      .update(definition.sql)
      .digest("hex");
    let generation = "stable",
      reads = 0;
    const service = createSourceQueryService({
      registry: async () => definition,
      pool: () => db.pool,
      authority: async () => ({
        generation: ++reads === 2 ? generation : "stable",
        userId: "legacy-user",
        now: "2026-01-01T00:00:00Z",
        tz: "UTC",
      }),
    });
    const input = {
      name: "answer",
      valuesJson: '{"needle":"bound-"}',
      offset: 0,
      limit: 1,
    };
    assert.equal(
      (await service.query(context, input)).rows[0]?.value,
      "bound-legacy-user",
    );
    reads = 0;
    generation = "revoked";
    await assert.rejects(service.query(context, input), {
      code: "dataset_changed",
    });
    reads = 0;
    generation = "stable";
    definition.sql =
      "SELECT repeat($needle::text,30000) AS value, $_me.id::text AS viewer";
    definition.sqlSha256 = createHash("sha256")
      .update(definition.sql)
      .digest("hex");
    await assert.rejects(
      service.query(context, {
        ...input,
        valuesJson: JSON.stringify({ needle: "é" }),
      }),
      { code: "invalid_dataset" },
    );
    reads = 0;
    definition.sql =
      "WITH changed AS (DELETE FROM items RETURNING value) SELECT value FROM changed";
    definition.params = {} as any;
    definition.sqlSha256 = createHash("sha256")
      .update(definition.sql)
      .digest("hex");
    await assert.rejects(
      service.query(context, { ...input, valuesJson: "{}" }),
    );
    assert.equal(
      (await db.pool.query("SELECT value FROM items")).rows[0]?.value,
      "original",
    );
  } finally {
    await db.cleanup();
  }
});
test("bounded JSON rows normalize native timestamp types even when driver column parsers cannot run", async () => {
  const db = await testDatabase();
  try {
    const sql =
      "SELECT timestamp '2026-10-15 00:00:00' AS plain, timestamptz '2026-10-15 00:00:00+05:30' AS zoned, date '2026-10-15' AS day, NULL::timestamp AS missing, timestamp 'infinity' AS plain_infinite, timestamptz 'infinity' AS zoned_infinite";
    const columns = [
      { name: "plain", type: "timestamp" as const },
      { name: "zoned", type: "timestamp" as const },
      { name: "day", type: "date" as const },
      { name: "missing", type: "timestamp" as const },
      { name: "plain_infinite", type: "timestamp" as const },
      { name: "zoned_infinite", type: "timestamp" as const },
    ];
    let empty = false;
    const service = createSourceQueryService({
      pool: () => db.pool,
      registry: async () => ({
        pageLegacyId: "legacy",
        pageVersion: 1,
        name: "times",
        sourceRef: "ref:ABC123",
        resource: "source-ABC123",
        params: {},
        columns,
        backendId: "BACK01",
        backendVersion: "1",
        pageId: "PAGE01",
        sourceNamespace: "test",
        sql: empty ? sql + " WHERE false" : sql,
        sqlSha256: createHash("sha256")
          .update(empty ? sql + " WHERE false" : sql)
          .digest("hex"),
      }),
      authority: async () => ({
        generation: "stable",
        userId: null,
        now: "2026-10-22T00:00:00Z",
        tz: "UTC",
      }),
    });
    const context = {
        backendId: "BACK01",
        backendVersion: "1",
        pageId: "PAGE01",
        subject: "user:test",
      },
      input = { name: "times", valuesJson: "{}", offset: 0, limit: 10 };
    assert.deepEqual((await service.query(context, input)).rows, [
      {
        plain: "2026-10-15T00:00:00.000Z",
        zoned: "2026-10-14T18:30:00.000Z",
        day: "2026-10-15",
        missing: null,
        plain_infinite: "infinity",
        zoned_infinite: null,
      },
    ]);
    empty = true;
    assert.deepEqual((await service.query(context, input)).rows, []);
  } finally {
    await db.cleanup();
  }
});

test("native timestamp metadata scales to maximum 256 columns within a bounded response", async () => {
  const db = await testDatabase();
  try {
    const columns = Array.from({ length: 256 }, (_, i) => ({
      name: "time_" + i,
      type: "timestamp" as const,
    }));
    const sql =
      "SELECT " +
      columns
        .map((c) => `timestamp '2026-10-15 00:00:00' AS "${c.name}"`)
        .join(",");
    const service = createSourceQueryService({
      pool: () => db.pool,
      registry: async () => ({
        pageLegacyId: "legacy",
        pageVersion: 1,
        name: "times",
        sourceRef: "ref:ABC123",
        resource: "source-ABC123",
        params: {},
        columns,
        backendId: "BACK01",
        backendVersion: "1",
        pageId: "PAGE01",
        sourceNamespace: "test",
        sql,
        sqlSha256: createHash("sha256").update(sql).digest("hex"),
      }),
      authority: async () => ({
        generation: "stable",
        userId: null,
        now: "2026-10-22T00:00:00Z",
        tz: "UTC",
      }),
    });
    const result = await service.query(
      {
        backendId: "BACK01",
        backendVersion: "1",
        pageId: "PAGE01",
        subject: "user:test",
      },
      { name: "times", valuesJson: "{}", offset: 0, limit: 1 },
    );
    assert.equal(Object.keys(result.rows[0]!).length, 256);
    assert.ok(
      Object.values(result.rows[0]!).every(
        (v) => v === "2026-10-15T00:00:00.000Z",
      ),
    );
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
  } finally {
    await db.cleanup();
  }
});
