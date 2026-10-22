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
