import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareMigrationBackends,
  registerMigrationBackends,
} from "../src/migration/backend-preparation.ts";
import { generatedDatasetBackendSource } from "../src/migration/datasets/import-metadata.ts";
import { sealDeployment, digest } from "../src/backend/deployment.ts";
import type { MigrationBackendPreparationInput } from "../src/migration/backend-preparation-contracts.ts";
const input: MigrationBackendPreparationInput = {
  sourceNamespace: "fixture",
  origin: "https://example.test",
  allocatedIds: ["Page12", "Page34"],
  pages: [
    {
      legacyId: "old-page",
      pageId: "Page12",
      owner: { kind: "user", id: "member" },
      revisions: [
        {
          version: 1,
          imports: [
            {
              name: "sales",
              legacyRef: "ds:1",
              datasetLegacyId: "ds",
              datasetVersion: 1,
            },
          ],
        },
        {
          version: 2,
          imports: [
            {
              name: "sales",
              legacyRef: "ds:2",
              datasetLegacyId: "ds",
              datasetVersion: 2,
            },
          ],
        },
      ],
    },
  ],
};
const deployment = sealDeployment(
  generatedDatasetBackendSource,
  "test compiled bundle",
  { typeDefs: generatedDatasetBackendSource.split("`")[1]!, fields: ["read"] },
);
test("one fixed compiled source yields stable per-page backend IDs and exact per-revision binding receipts", async () => {
  let calls = 0;
  const host = {
    compile: async (source: string) => {
      calls++;
      assert.equal(source, generatedDatasetBackendSource);
      return deployment;
    },
    invoke: async () => null,
  };
  const prepared = await prepareMigrationBackends(input, { host });
  assert.equal(calls, 1);
  assert.equal(prepared.receipts.length, 2);
  assert.equal(prepared.bindings.length, 2);
  const [a, b] = prepared.receipts;
  assert.ok(a && b);
  assert.match(a.backendId, /^[A-Za-z0-9]{6}$/);
  assert.equal(a.backendId, b.backendId);
  assert.equal(a.backendNamespace, "legacyData");
  assert.equal(a.sourceSha256, digest(generatedDatasetBackendSource));
  assert.equal(a.bundleSha256, digest(deployment.bundle));
  assert.deepEqual(a.deployment, deployment);
  assert.deepEqual(
    prepared.bindings.map((v) => [v.pageVersion, v.datasetVersion]),
    [
      [1, 1],
      [2, 2],
    ],
  );
  assert.deepEqual(await prepareMigrationBackends(input, { host }), prepared);
  const collision = await prepareMigrationBackends(
    { ...input, allocatedIds: [...input.allocatedIds, a.backendId] },
    { host },
  );
  assert.notEqual(collision.receipts[0]!.backendId, a.backendId);
});
test("group pages and malformed Import descriptors fail before compilation; empty imports need no host", async () => {
  let calls = 0;
  const host = {
    compile: async () => {
      calls++;
      return deployment;
    },
    invoke: async () => null,
  };
  await assert.rejects(
    prepareMigrationBackends(
      {
        ...input,
        pages: [
          { ...input.pages[0]!, owner: { kind: "group", id: "group:fixture" } },
        ],
      },
      { host },
    ),
    /Group/,
  );
  await assert.rejects(
    prepareMigrationBackends(
      {
        ...input,
        pages: [
          {
            ...input.pages[0]!,
            revisions: [
              {
                version: 1,
                imports: [
                  {
                    ...input.pages[0]!.revisions[0]!.imports[0]!,
                    datasetVersion: 0,
                  },
                ],
              },
            ],
          },
        ],
      },
      { host },
    ),
    /Invalid/,
  );
  assert.equal(calls, 0);
  assert.deepEqual(await prepareMigrationBackends({ ...input, pages: [] }), {
    receipts: [],
    bindings: [],
  });
});
test("registration rejects altered compiled receipts before touching destination SQL", async () => {
  const prepared = await prepareMigrationBackends(input, {
    host: { compile: async () => deployment, invoke: async () => null },
  });
  let queries = 0;
  await assert.rejects(
    registerMigrationBackends(
      {
        query: async () => {
          queries++;
          return { rows: [] };
        },
      },
      [{ ...prepared.receipts[0]!, sourceSha256: "0".repeat(64) }],
    ),
    /receipt/,
  );
  assert.equal(queries, 0);
});

test("same-owner backend IDs from a different page are collisions, never reused", async () => {
  const prepared = await prepareMigrationBackends(input, {
    host: { compile: async () => deployment, invoke: async () => null },
  });
  const receipt = prepared.receipts[0]!;
  const statements: string[] = [];
  await assert.rejects(
    registerMigrationBackends(
      {
        query: async (sql) => {
          statements.push(sql);
          if (sql.includes("FROM files f"))
            return { rows: [{ owner: receipt.owner, principal_kind: "user" }] };
          if (sql.includes("FROM retired_file_ids")) return { rows: [] };
          if (sql.includes("FROM file_ids"))
            return {
              rows: [
                { owner: receipt.owner, kind: "backend", published: true },
              ],
            };
          if (sql.includes("FROM af_backend_files"))
            return {
              rows: [{ owner: receipt.owner, page_id: "Page34", deployment }],
            };
          throw Error("Unexpected destination mutation");
        },
      },
      [receipt],
    ),
    /collision/,
  );
  assert.ok(statements.every((sql) => sql.startsWith("SELECT")));
});
