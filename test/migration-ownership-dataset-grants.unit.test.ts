import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareMigrationOwnershipDatasetGrants,
  projectMigrationOwnershipDatasetGrants,
  validateMigrationOwnershipDatasetGrantBatch,
  migrationOwnershipResourceDigest,
} from "../src/migration/ownership-dataset-grants.ts";
import {
  migrationOwnershipScopeDigest,
  migrationOwnershipSourceDigest,
} from "../src/migration/ownership-override.ts";
import type { DatasetImportMetadata } from "../src/datasets/import-contracts.ts";
import type { MigrationJobSource } from "../src/migration/job-contracts.ts";
import type { LegacyArtifact } from "../src/migration/contracts.ts";
function fixture() {
  const page = {
    id: "page01",
    version: 1,
    format: "markup",
    source: "<p>Original</p>",
    user_id: null,
    group_id: null,
    token_id: "anonymous",
    visibility: "public",
    edit_id: "saved",
    document: null,
    link_role: "viewer",
  } as LegacyArtifact;
  const dataset = {
    ...page,
    id: "data01",
    format: "dataset",
    source: null,
    visibility: "unlisted",
    access: "readwrite",
    dataset_policy: null,
  } as LegacyArtifact;
  const resource = {
    legacyId: "data01",
    currentVersion: 1,
    writable: true,
    policyRevision: 0,
    owner: "legacy-token:" + "a".repeat(64),
    generation: 1,
    access: {
      visibility: "unlisted",
      linkRole: "viewer",
      shares: {},
      version: 0,
    },
    deleted: false,
    snapshot: {
      id: "data01",
      owner: { userId: null, tokenId: "anonymous" },
      visibility: "unlisted",
      policyRevision: 0,
      ownerIsTestUser: false,
      policy: null,
    },
  } as DatasetImportMetadata["resources"][number];
  const metadata = {
    sourceNamespace: "fixture",
    resources: [resource],
    bindings: [],
    pages: [],
    versions: [],
    principals: [],
    groups: [],
    acceptedJoins: [],
    operations: [
      {
        sourceNamespace: "fixture",
        bindingName: "data",
        operation: {
          name: "save",
          backendId: "back01",
          backendVersion: "b".repeat(64),
          page: {
            id: "page01",
            legacyId: "page01",
            version: 1,
            editId: "saved",
          },
          datasetId: "data01",
          target: { schema: "public", table: "rows" },
          sql: "update data.rows set value=1",
          paramTypes: {},
          conflictMode: "refuse",
        },
      },
    ],
  } satisfies DatasetImportMetadata;
  const base = {
    schemaVersion: 1 as const,
    sourceNamespace: "fixture",
    targetEmail: "owner@example.test",
    entries: [
      { legacyId: page.id, sourceSha256: migrationOwnershipSourceDigest(page) },
    ],
    datasetWriteGrants: [
      {
        legacyId: dataset.id,
        sourceSha256: migrationOwnershipSourceDigest(dataset),
        originalResourceSha256: migrationOwnershipResourceDigest(resource),
        operations: [{ pageLegacyId: page.id, operationName: "save" }],
      },
    ],
  };
  const policy = { ...base, scopeSha256: migrationOwnershipScopeDigest(base) };
  const source = {
    manifest: { sourceNamespace: "fixture" },
    readArtifact: async (id: string) => ({
      artifacts: [id === page.id ? page : dataset],
    }),
  } as unknown as MigrationJobSource;
  return { source, policy, metadata, page, dataset, resource };
}
test("exact approved dependency gets only an editor share and immutable audit; blocked write pages get none", async () => {
  const f = fixture();
  const audits = await prepareMigrationOwnershipDatasetGrants(
    f.source,
    f.metadata,
    f.policy,
  );
  const result = projectMigrationOwnershipDatasetGrants(
    f.metadata,
    audits,
    f.policy,
  );
  assert.deepEqual(result.metadata.resources[0]!.access.shares, {
    "owner@example.test": "editor",
  });
  assert.equal(result.metadata.resources[0]!.owner, f.resource.owner);
  assert.equal(result.metadata.resources[0]!.access.visibility, "unlisted");
  assert.deepEqual(f.resource.access.shares, {});
  assert.equal(result.ownershipDatasetGrants.length, 1);
  validateMigrationOwnershipDatasetGrantBatch(
    result.metadata,
    result.ownershipDatasetGrants,
    f.policy,
  );
  assert.deepEqual(
    await prepareMigrationOwnershipDatasetGrants(
      f.source,
      f.metadata,
      f.policy,
    ),
    audits,
  );
  assert.deepEqual(
    projectMigrationOwnershipDatasetGrants(
      { ...f.metadata, operations: [] },
      audits,
      f.policy,
    ).ownershipDatasetGrants,
    [],
  );
  assert.throws(
    () =>
      validateMigrationOwnershipDatasetGrantBatch(
        result.metadata,
        [],
        f.policy,
      ),
    /Unattested/,
  );
  assert.throws(
    () =>
      validateMigrationOwnershipDatasetGrantBatch(
        result.metadata,
        result.ownershipDatasetGrants,
      ),
    /Trusted/,
  );
});
test("changed dataset/page source, original ACL and out-of-scope operations refuse", async () => {
  for (const change of ["dataset", "page", "acl", "operation"] as const) {
    const f = fixture();
    if (change === "dataset") f.dataset.version++;
    if (change === "page") f.page.source = "<p>Changed</p>";
    if (change === "acl") f.resource.access.linkRole = "editor";
    if (change === "operation")
      f.metadata.operations[0]!.operation.name = "other";
    await assert.rejects(
      prepareMigrationOwnershipDatasetGrants(f.source, f.metadata, f.policy),
      /differ/,
    );
  }
  const f = fixture();
  f.policy.datasetWriteGrants[0]!.operations[0]!.pageLegacyId = "other";
  f.policy.scopeSha256 = migrationOwnershipScopeDigest(f.policy);
  await assert.rejects(
    prepareMigrationOwnershipDatasetGrants(f.source, f.metadata, f.policy),
    /operation scope/,
  );
});

test("audit is compare-or-insert on first import; retries and independent verification refuse deletion or alteration", async () => {
  const {
    persistMigrationOwnershipDatasetGrantAudit: persist,
    verifyMigrationOwnershipDatasetGrantAudit: verify,
  } = await import("../src/migration/ownership-dataset-grant-audit.ts");
  const f = fixture(),
    audits = await prepareMigrationOwnershipDatasetGrants(
      f.source,
      f.metadata,
      f.policy,
    );
  let rows: Record<string, unknown>[] = [];
  let inserts = 0;
  const db = {
    query: async (text: string, values?: unknown[]) => {
      if (text.startsWith("SELECT")) return { rows: structuredClone(rows) };
      if (text.startsWith("INSERT")) {
        inserts++;
        rows.push({
          dataset_id: values![1],
          audit: JSON.parse(String(values![2])),
        });
      }
      return { rows: [] };
    },
  };
  await persist(db, "migration", "fixture", audits, false);
  assert.equal(inserts, 1);
  await persist(db, "migration", "fixture", audits, true);
  assert.equal(inserts, 1);
  assert.equal(await verify(db, "migration", "fixture", audits), 1);
  rows = [];
  await assert.rejects(
    persist(db, "migration", "fixture", audits, true),
    /removed/,
  );
  assert.equal(inserts, 1);
  await assert.rejects(verify(db, "migration", "fixture", audits), /differs/);
  rows = [
    {
      dataset_id: "data01",
      audit: { ...audits[0], assignedEditor: "other@example.test" },
    },
  ];
  await assert.rejects(
    persist(db, "migration", "fixture", audits, true),
    /differs/,
  );
  assert.equal(inserts, 1);
});
