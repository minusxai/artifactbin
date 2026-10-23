import type { SqlReader } from "../src/migration/contracts.ts";
// @requires migration-database
import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./dataset-runtime-fixture.ts";
import { registerMigrationBackends } from "../src/migration/backend-preparation.ts";
import { generatedDatasetBackendSource } from "../src/migration/datasets/import-metadata.ts";
import { readBackendModule } from "../src/backend/af-module.ts";
import { boundedBackendSchema } from "../src/graphql/execution-policy.ts";
import { sealDeployment, digest } from "../src/backend/deployment.ts";
import type { MigrationBackendReceipt } from "../src/migration/backend-preparation-contracts.ts";
test("concurrent page transactions share an owner without lock upgrades and keep principal authority stable", async () => {
  const { env } = await fixture();
  const clients: (SqlReader & { release(): void })[] = await Promise.all([
    env.pool.connect(),
    env.pool.connect(),
    env.pool.connect(),
  ]);
  const module = await readBackendModule(generatedDatasetBackendSource),
    schema = boundedBackendSchema(module.typeDefs);
  const deployment = sealDeployment(
    generatedDatasetBackendSource,
    "test compiled bundle",
    {
      typeDefs: module.typeDefs,
      fields: [
        ...Object.keys(schema.getQueryType()?.getFields() ?? {}),
        ...Object.keys(schema.getMutationType()?.getFields() ?? {}),
      ],
    },
  );
  const receipts: MigrationBackendReceipt[] = ["Page11", "Page22"].map(
    (pageId, i) => ({
      pageLegacyId: "old-" + pageId,
      pageId,
      pageVersion: 1,
      linked: true,
      owner: "owner",
      backendId: "Bk100" + (i + 1),
      backendNamespace: "legacyData",
      backendHref: "https://example.test/af/v1/ids/Bk100" + (i + 1),
      sourceSha256: digest(generatedDatasetBackendSource),
      bundleSha256: digest(deployment.bundle),
      deployment,
    }),
  );
  try {
    // Both FK insertions acquire KEY SHARE on the same owner before backend publication.
    await Promise.all(
      clients.slice(0, 2).map(async (client, i) => {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout='500ms'");
        await client.query(
          "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES($1,'owner','page',true,0)",
          [receipts[i]!.pageId],
        );
        await client.query(
          "INSERT INTO files(id,owner,share_hash,generation,head) VALUES($1,'owner','hash',1,'1')",
          [receipts[i]!.pageId],
        );
      }),
    );
    await Promise.all(
      clients
        .slice(0, 2)
        .map((client, i) => registerMigrationBackends(client, [receipts[i]!])),
    );
    // Shared ownership checks must still prevent principal changes until publication commits.
    const observer = clients[2]!;
    await observer.query("BEGIN");
    await observer.query("SET LOCAL lock_timeout='100ms'");
    await assert.rejects(
      observer.query("UPDATE accounts SET name='changed' WHERE actor='owner'"),
      (error: any) => error.code === "55P03",
    );
    await observer.query("ROLLBACK");
    await Promise.all(
      clients.slice(0, 2).map((client) => client.query("COMMIT")),
    );
    assert.equal(
      (
        await observer.query(
          "SELECT count(*)::int n FROM af_backend_files WHERE file_id=ANY($1::text[])",
          [receipts.map((r) => r.backendId)],
        )
      ).rows[0]!.n,
      2,
    );
    await observer.query(
      "INSERT INTO accounts(actor,principal_kind) VALUES('group:fixture','group')",
    );
    await observer.query(
      "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES('Group1','group:fixture','page',true,0)",
    );
    await observer.query(
      "INSERT INTO files(id,owner,share_hash,generation,head) VALUES('Group1','group:fixture','hash',1,'1')",
    );
    await assert.rejects(
      registerMigrationBackends(observer, [
        { ...receipts[0]!, pageId: "Group1", owner: "group:fixture" },
      ]),
      /person-owned page/,
    );
  } finally {
    await Promise.all(clients.map((c) => c.query("ROLLBACK").catch(() => {})));
    for (const c of clients) c.release();
    await env.cleanup();
  }
});
