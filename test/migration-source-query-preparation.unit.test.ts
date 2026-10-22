import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { attestMigrationSourceQueries } from "../src/migration/source-query-preparation.ts";
const sql = "select 1 as value";
const source =
  '<Helmet><Query name="q" source="ref:source01">{`' +
  sql +
  "`}</Query></Helmet>";
const registration = {
  pageLegacyId: "page01",
  pageVersion: 1,
  name: "q",
  sourceRef: "ref:source01",
  resource: "source-source01",
  sql,
  sqlSha256: createHash("sha256").update(sql).digest("hex"),
  params: {},
  columns: [{ name: "value", type: "number" as const }],
};
test("source query authority requires exact current page/source/name/SQL and complete declared query set", () => {
  assert.deepEqual(
    attestMigrationSourceQueries(source, "page01", 1, [registration]),
    [registration],
  );
  assert.deepEqual(
    attestMigrationSourceQueries(source, "page01", 0, [registration]),
    [],
  );
  for (const change of [
    { sql: "select 2 as value" },
    { sourceRef: "ref:source02" },
    { name: "other" },
    { resource: "source-unrelated" },
  ])
    assert.throws(
      () =>
        attestMigrationSourceQueries(source, "page01", 1, [
          { ...registration, ...change },
        ]),
      /source query/i,
    );
  assert.throws(
    () =>
      attestMigrationSourceQueries(
        source.replace(
          "</Helmet>",
          '<Query name="other" source="ref:source01">{`select 2`}</Query></Helmet>',
        ),
        "page01",
        1,
        [registration],
      ),
    /source query/i,
  );
});

test("source-only metadata preserves current original page authority; publication accepts only exact trusted named queries", async () => {
  const { planDatasetMetadata } = await import(
    "../src/migration/datasets/import-metadata.ts"
  );
  const { validateMigrationSourceQueryBatch } = await import(
    "../src/migration/source-query-preparation.ts"
  );
  const page = {
    id: "page01",
    format: "markup",
    version: 1,
    user_id: "owner",
    group_id: null,
    token_id: "",
    source,
    document: null,
    visibility: "unlisted",
    link_role: "viewer",
    edit_id: "saved",
  };
  const result = planDatasetMetadata({
    manifest: {
      schemaVersion: 1,
      sourceNamespace: "fixture",
      exportedAt: new Date(0).toISOString(),
      artifacts: [page],
      tables: { relations: [], users: [{ id: "owner", kind: "account" }] },
      tokenOwners: [],
    },
    maps: {
      users: { owner: "owner@example.test" },
      groups: {},
      tokens: {},
      pages: { page01: "Page01" },
    },
    receipts: [],
    bindings: [],
    sourceQueryPages: [
      { pageLegacyId: "page01", pageId: "Page01", pageVersion: 1 },
    ],
    relationProvenance: {
      exportedAt: new Date(0).toISOString(),
      manifestSha256: "a".repeat(64),
    },
  });
  assert.equal(result.metadata.pages.length, 1);
  assert.equal(result.metadata.resources.length, 0);
  assert.equal(result.metadata.bindings.length, 0);
  const groups = [
    {
      receipt: {
        pageLegacyId: "page01",
        pageId: "Page01",
        pageVersion: 1,
        backendId: "Back01",
        deployment: { version: "b".repeat(64) },
      },
      queries: [registration],
    },
  ];
  validateMigrationSourceQueryBatch(result.metadata, groups, [registration]);
  assert.throws(
    () => validateMigrationSourceQueryBatch(result.metadata, groups),
    /scope/,
  );
  assert.throws(
    () =>
      validateMigrationSourceQueryBatch(result.metadata, [], [registration]),
    /scope/,
  );
  assert.throws(
    () =>
      validateMigrationSourceQueryBatch(
        result.metadata,
        [...groups, ...groups],
        [registration],
      ),
    /Duplicate/,
  );
});

test("source-query scan refuses unknown, historical, deleted and changed-source attestations before preparation", async () => {
  const { scanMigrationDatasetImports } = await import(
    "../src/migration/dataset-scan.ts"
  );
  const page = {
    id: "page01",
    version: 1,
    format: "markup",
    source,
    document: null,
    user_id: "owner",
    group_id: null,
    token_id: "",
    visibility: "private",
    link_role: "viewer",
  };
  const manifest = {
    schemaVersion: 1 as const,
    sourceNamespace: "fixture",
    exportedAt: new Date(0).toISOString(),
    artifacts: [page],
    tables: {},
    tokenOwners: [],
  };
  const fixture = {
    ids: ["page01"],
    manifest: {
      schemaVersion: 2,
      sourceNamespace: "fixture",
      schema: "legacy",
      exportedAt: new Date(0).toISOString(),
      parts: [],
    },
    base: manifest,
    maps: {
      pages: { page01: "Page01" },
      users: { owner: "owner@example.test" },
      groups: {},
      tokens: {},
    },
    identitySummary: {},
    groupSummary: {},
    media: null,
    readArtifact: async () => manifest,
  } as unknown as import("../src/migration/job-contracts.ts").MigrationJobSource;
  const scan = await scanMigrationDatasetImports(fixture, undefined, [
    registration,
  ]);
  assert.equal(scan.pages[0]?.revisions[0]?.sourceQueries?.length, 1);
  for (const changed of [
    { ...registration, pageLegacyId: "missing" },
    { ...registration, pageVersion: 0 },
  ])
    await assert.rejects(
      scanMigrationDatasetImports(fixture, undefined, [changed]),
      /source query attestation/i,
    );
  await assert.rejects(
    scanMigrationDatasetImports(
      {
        ...fixture,
        readArtifact: async () => ({
          ...manifest,
          artifacts: [{ ...page, deleted_at: "2026-01-01" }],
        }),
      },
      undefined,
      [registration],
    ),
    /active current/i,
  );
  await assert.rejects(
    scanMigrationDatasetImports(
      {
        ...fixture,
        readArtifact: async () => ({
          ...manifest,
          artifacts: [{ ...page, source: "<p>Changed</p>" }],
        }),
      },
      undefined,
      [registration],
    ),
    /attestation/i,
  );
});
