import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareMigrationJobDatasets } from "../src/migration/job-datasets.ts";
import { sealDeployment } from "../src/backend/deployment.ts";
import { generatedDatasetBackendSource } from "../src/migration/datasets/import-metadata.ts";
import type {
  MigrationJobOptions,
  MigrationJobSource,
} from "../src/migration/job-contracts.ts";
import type {
  MigrationManifest,
  LegacyArtifact,
} from "../src/migration/contracts.ts";
test("job prepares exact live head bindings and real compiled receipts without inventing historical execution", async () => {
  const sha = createHash("sha256").update("[]").digest("hex");
  const base: MigrationManifest = {
    schemaVersion: 1,
    sourceNamespace: "fixture",
    exportedAt: "epoch",
    tables: { users: [{ id: "owner", kind: "user" }] },
    artifacts: [],
    tokenOwners: [
      { id: "token", user_id: "owner" },
      { id: "unrelated", user_id: "missing" },
    ],
  };
  const page: LegacyArtifact = {
    id: "abc123",
    version: 2,
    format: "markup",
    source:
      '<Helmet><Import name="sales" src="ref:data01"/><Value name="n" type="number"/><Mutation name="updateValue">{`update sales.rows set value=$n`}</Mutation></Helmet>',
    document: null,
    user_id: "owner",
    group_id: null,
    token_id: "token",
    visibility: "private",
    link_role: "viewer",
    edit_id: "actual-head-edit",
  };
  const dataset: LegacyArtifact = {
    ...page,
    id: "data01",
    version: 3,
    format: "dataset",
    source: null,
    meta: {
      catalog: {
        kind: "stored",
        tables: [
          {
            schema: "public",
            name: "rows",
            columns: [{ name: "value", type: "number" }],
            objectKey: "dataset/" + sha.slice(0, 32),
          },
        ],
      },
    },
  };
  const source: MigrationJobSource = {
    manifest: {
      schemaVersion: 2,
      sourceNamespace: "fixture",
      schema: "legacy",
      exportedAt: "epoch",
      parts: [],
    },
    base,
    maps: {
      pages: { abc123: "abc123", data01: "data01" },
      users: { owner: "owner@example.test" },
      tokens: { token: "owner@example.test" },
      groups: {},
    },
    ids: ["abc123", "data01"],
    identitySummary: {},
    groupSummary: {},
    media: null,
    datasets: {
      receipts: [
        {
          objectKey: "dataset/" + sha.slice(0, 32),
          status: "copied",
          sha256: sha,
          bytes: 2,
        },
      ],
      relations: [],
      provenance: {
        baseManifestSha256: "a".repeat(64),
        relationManifestSha256: "b".repeat(64),
        relationExportedAt: "2026-10-22T00:00:00Z",
      },
      verifiedObjects: 1,
      verifiedBytes: 2,
    },
    readArtifact: async (id): Promise<MigrationManifest> =>
      id === "abc123"
        ? {
            ...base,
            artifacts: [page],
            tables: {
              artifact_versions: [
                {
                  artifact_id: "abc123",
                  version: 1,
                  format: "markup",
                  source: page.source,
                },
              ],
            },
          }
        : { ...base, artifacts: [dataset], tables: {} },
  };
  const options: MigrationJobOptions = {
    sourceDirectory: "unused",
    indexDirectory: "unused",
    reportPath: "unused",
    schema: "isolated",
    apply: false,
    concurrency: 1,
    origin: "https://new.example.test",
    legacyOrigins: [],
    editorManageRestricted: true,
    conversionStrategy: "archived-functional",
  };
  let compilations = 0;
  const deployment = sealDeployment(
    generatedDatasetBackendSource,
    "compiled fixture",
    {
      typeDefs: generatedDatasetBackendSource.split("`")[1]!,
      fields: ["read", "mutate"],
    },
  );
  const plan = await prepareMigrationJobDatasets(source, options, {
    host: {
      compile: async () => {
        compilations++;
        return deployment;
      },
      invoke: async () => null,
    },
  });
  assert.ok(plan);
  assert.equal(compilations, 1);
  assert.equal(plan.omittedUnmappedTokenPrincipals, 1);
  assert.equal(plan.metadata.bindings.length, 1);
  assert.equal(plan.metadata.operations?.length, 1);
  assert.equal(
    plan.metadata.operations?.[0]?.operation.page.editId,
    "actual-head-edit",
  );
  assert.equal(plan.metadata.bindings[0]!.mode, "live");
  assert.equal(plan.metadata.pages[0]!.snapshot.editId, "actual-head-edit");
  assert.equal(plan.bindings.has(JSON.stringify(["abc123", 1])), false);
  assert.equal(
    plan.bindings.get(JSON.stringify(["abc123", 2]))![0]!.name,
    "sales",
  );
  assert.deepEqual(
    plan.backends.get("abc123")!.map((r) => r.linked),
    [false, true],
  );
  assert.match(plan.allocation.inventorySha256, /^[a-f0-9]{64}$/);
});
