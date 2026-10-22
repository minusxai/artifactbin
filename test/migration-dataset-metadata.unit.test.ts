import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  planDatasetMetadata,
  generatedDatasetBackendSource,
} from "../src/migration/datasets/import-metadata.ts";
import type { DatasetMetadataInput } from "../src/migration/datasets/planner-contracts.ts";
const digest = createHash("sha256").update("[]").digest("hex");
function input(): DatasetMetadataInput {
  const dataset = {
    id: "dataset",
    format: "dataset",
    version: 2,
    user_id: "user",
    token_id: "token",
    group_id: null,
    source: null,
    document: null,
    visibility: "private",
    link_role: "viewer",
    edit_id: "dataedit",
    dataset_policy: null,
    policy_revision: 3,
    sharing_revision: 1,
    meta: {
      catalog: {
        kind: "stored",
        defaultSchema: "public",
        refreshSeconds: 0,
        tables: [
          {
            schema: "public",
            name: "rows",
            columns: [{ name: "value", type: "number" }],
            objectKey: "dataset/" + digest.slice(0, 32),
          },
        ],
      },
    },
  };
  const page = {
    ...dataset,
    id: "document",
    format: "markup",
    version: 1,
    edit_id: "docedit",
    meta: {},
  };
  return {
    relationProvenance: {
      exportedAt: "2026-01-02T00:00:00Z",
      manifestSha256: "b".repeat(64),
    },
    manifest: {
      schemaVersion: 1,
      sourceNamespace: "example",
      exportedAt: "2026-01-01T00:00:00Z",
      artifacts: [dataset, page],
      tables: {
        users: [{ id: "user", kind: "user", expires_at: null }],
        groups: [],
        artifact_shares: [],
        artifact_versions: [
          {
            artifact_id: "dataset",
            version: 1,
            format: "dataset",
            meta: dataset.meta,
          },
        ],
        relations: [],
      },
      tokenOwners: [{ id: "token", user_id: "user" }],
    },
    maps: {
      users: { user: "actor" },
      tokens: { token: "actor" },
      groups: {},
      pages: { document: "Doc123", dataset: "Dat123" },
    },
    receipts: [
      {
        objectKey: "dataset/" + digest.slice(0, 32),
        status: "copied",
        sha256: digest,
        bytes: 2,
      },
    ],
    bindings: [
      {
        pageLegacyId: "document",
        pageVersion: 1,
        pageId: "Doc123",
        backendId: "Back12",
        backendVersion: "a".repeat(64),
        backendNamespace: "legacyDatasets",
        name: "data",
        legacyRef: "dataset",
        datasetLegacyId: "dataset",
        datasetVersion: 2,
      },
    ],
  };
}
test("all immutable versions and current resource authority stay separate; browser receives metadata only", () => {
  const plan = planDatasetMetadata(input());
  assert.equal(plan.metadata.versions.length, 2);
  assert.equal(plan.metadata.resources[0]?.policyRevision, 3);
  assert.equal(plan.metadata.resources[0]?.generation, 1);
  assert.equal(plan.metadata.versions[0]?.tables[0]?.object.key, digest);
  assert.equal(plan.metadata.bindings[0]?.page.legacyId, "document");
  const browser = JSON.stringify(plan.browserBindings);
  assert.equal(browser.includes(digest), false);
  assert.equal(browser.includes("policy"), false);
  assert.match(generatedDatasetBackendSource, /caps\.dataset\.read/);
  assert.match(generatedDatasetBackendSource, /caps\.dataset\.mutate/);
  assert.match(generatedDatasetBackendSource, /@auth\(role: VIEWER\)/);
});
test("changed duplicate version metadata and ambiguous object receipts fail closed", () => {
  const a = input();
  a.manifest.tables.artifact_versions!.push({
    ...a.manifest.tables.artifact_versions![0],
    meta: { catalog: { kind: "stored", tables: [] } },
  });
  assert.throws(() => planDatasetMetadata(a));
  const b = input();
  b.receipts = [...b.receipts, ...b.receipts];
  assert.throws(() => planDatasetMetadata(b));
});
test("model and external catalogs remain archived but cannot become empty readable tables", () => {
  const a = input();
  const meta = a.manifest.artifacts[0]!.meta as {
    catalog: { tables: unknown[] };
  };
  meta.catalog.tables.push({
    schema: "public",
    name: "model",
    columns: [],
    sql: "select 1",
  });
  const plan = planDatasetMetadata(a);
  assert.equal(
    plan.metadata.versions.find((v) => v.version === 2)?.unavailableTables[0]
      ?.reason,
    "model",
  );
  assert.equal(plan.browserBindings[0]?.binding.tables.length, 1);
});

test("accepted joins come only from exact accepted source relations, including legacy deleted markers", () => {
  const a = input();
  a.manifest.tables.relations = [
    {
      subject_kind: "user",
      subject_id: "user",
      verb: "join",
      object_kind: "artifact",
      object_id: "document",
      status: "accepted",
      deleted_at: "2020-01-01",
    },
    {
      subject_kind: "user",
      subject_id: "user",
      verb: "join",
      object_kind: "artifact",
      object_id: "other",
      status: "pending",
    },
  ];
  const plan = planDatasetMetadata(a);
  assert.deepEqual(plan.metadata.acceptedJoins, [
    { pageId: "Doc123", legacyUserId: "user" },
  ]);
  assert.equal(
    plan.provenance.relationExportedAt,
    a.relationProvenance.exportedAt,
  );
  assert.notEqual(
    plan.provenance.baseExportedAt,
    plan.provenance.relationExportedAt,
  );
  a.manifest.tables.relations = [];
  assert.deepEqual(planDatasetMetadata(a).metadata.acceptedJoins, []);
});
test("principal expiration survives planning and ambiguous actors or missing object receipts refuse admission", () => {
  const a = input();
  a.manifest.tables.users![0]!.expires_at = "2027-01-01T00:00:00Z";
  assert.equal(
    planDatasetMetadata(a).metadata.principals[0]?.expiresAt,
    "2027-01-01T00:00:00Z",
  );
  a.manifest.tables.users!.push({ id: "other", kind: "user" });
  a.maps.users.other = "actor";
  assert.throws(() => planDatasetMetadata(a));
  const b = input();
  b.receipts = [];
  assert.throws(() => planDatasetMetadata(b));
});
test("external catalog is archived as unavailable and conflicting legacy aliases fail closed", () => {
  const a = input();
  const meta = a.manifest.artifacts[0]!.meta as {
    catalog: { kind: string };
    objectKey?: string;
  };
  meta.catalog.kind = "postgres";
  const plan = planDatasetMetadata(a);
  const version = plan.metadata.versions.find((v) => v.version === 2)!;
  assert.deepEqual(version.tables, []);
  assert.equal(version.unavailableTables[0]?.reason, "external");
  const b = input();
  (b.manifest.artifacts[0]!.meta as Record<string, unknown>).objectKey =
    "dataset/" + "f".repeat(32);
  assert.throws(() => planDatasetMetadata(b));
});
test("writability derives only explicit legacy readwrite and unversioned imports remain live", () => {
  const a = input();
  assert.equal(planDatasetMetadata(a).metadata.resources[0]?.writable, false);
  a.manifest.artifacts[0]!.access = "readwrite";
  const p = planDatasetMetadata(a);
  assert.equal(p.metadata.resources[0]?.writable, true);
  assert.equal(p.browserBindings[0]?.binding.mode, "live");
});
test("historical saved page uses only exact proven archived edit identity, never the current edit id", () => {
  const a = input();
  a.manifest.artifacts[1]!.version = 2;
  assert.throws(() => planDatasetMetadata(a));
  a.manifest.tables.artifact_versions!.push({
    artifact_id: "document",
    format: "markup",
    version: 1,
    edit_id: "proven-historical-edit",
    source: "old",
  });
  const p = planDatasetMetadata(a);
  assert.equal(p.metadata.bindings[0]?.page.editId, "proven-historical-edit");
  delete a.manifest.tables.artifact_versions!.at(-1)!.edit_id;
  assert.throws(() => planDatasetMetadata(a));
});
test("unrelated unmapped token provenance is counted, while an actual unmapped token owner fails closed", () => {
  const a = input();
  a.manifest.tokenOwners.push({ id: "orphan", user_id: null });
  assert.equal(planDatasetMetadata(a).diagnostics.unmappedTokenPrincipals, 1);
  a.manifest.artifacts[0]!.user_id = null;
  a.manifest.artifacts[0]!.token_id = "orphan";
  assert.throws(() => planDatasetMetadata(a));
});
