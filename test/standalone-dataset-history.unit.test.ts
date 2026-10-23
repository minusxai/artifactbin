import { test } from "node:test";
import assert from "node:assert/strict";
import { standaloneDatasetFixture } from "./support/standalone-dataset.ts";
import { datasetPageArtifactSha256 } from "../src/migration/dataset-pages/scan.ts";
import { admitStandaloneDatasetHistory } from "../src/migration/dataset-pages/history.ts";

test("exact saved dataset history preserves raw metadata and genuine missing original versions", async () => {
  const { artifact, source, options } = standaloneDatasetFixture();
  artifact.version = 5;
  const old = {
    ...artifact,
    id: "archive-record",
    artifact_id: artifact.id,
    version: 3,
    edit_id: "older",
    meta: { columns: [{ name: "old", type: "string" }] },
  };
  const manifest = {
    ...(await source.readArtifact(artifact.id)),
    tables: { artifact_versions: [old] },
  };
  const admission = options.standaloneDatasetPages!;
  admission.heads = [
    {
      legacyId: artifact.id,
      version: 5,
      artifactSha256: datasetPageArtifactSha256(artifact),
    },
  ];
  admission.history = {
    kind: "standalone-dataset-history-v1",
    revisions: [
      {
        legacyId: artifact.id,
        version: 3,
        artifactSha256: datasetPageArtifactSha256(old),
      },
    ],
  };
  const rows = admitStandaloneDatasetHistory(manifest, admission, artifact.id);
  assert.deepEqual(
    rows.map((r) => r.version),
    [5, 3],
  );
  assert.equal(rows[1], old);
  assert.deepEqual(rows[1]!.meta, old.meta);
  assert.equal(
    rows.some((r) => r.version === 1),
    false,
  );
  assert.throws(
    () =>
      admitStandaloneDatasetHistory(
        { ...manifest, tables: { artifact_versions: [] } },
        admission,
        artifact.id,
      ),
    /history inventory/,
  );
  assert.throws(
    () =>
      admitStandaloneDatasetHistory(
        {
          ...manifest,
          tables: { artifact_versions: [old, { ...old, meta: {} }] },
        },
        admission,
        artifact.id,
      ),
    /duplicate/,
  );
  old.meta = { columns: [] };
  assert.throws(
    () => admitStandaloneDatasetHistory(manifest, admission, artifact.id),
    /history source changed/,
  );
});
test("legacy head-only admission does not silently register archives", async () => {
  const { artifact, source, options } = standaloneDatasetFixture();
  const manifest = {
    ...(await source.readArtifact(artifact.id)),
    tables: { artifact_versions: [{ artifact_id: artifact.id, version: 99 }] },
  };
  assert.deepEqual(
    admitStandaloneDatasetHistory(
      manifest,
      options.standaloneDatasetPages!,
      artifact.id,
    ),
    [artifact],
  );
});

test("expanded preparation and HTML planning retain every version's catalog and binding", async () => {
  const { prepareStandaloneDatasetJob } = await import(
    "../src/migration/dataset-pages/job.ts"
  );
  const { createMigrationJobPlanner } = await import(
    "../src/migration/job-planning.ts"
  );
  const { standaloneDatasetHost } = await import(
    "./support/standalone-dataset.ts"
  );
  const { artifact, source, options } = standaloneDatasetFixture();
  artifact.version = 5;
  const old = {
    ...artifact,
    id: "archive-row",
    artifact_id: artifact.id,
    version: 3,
    edit_id: undefined,
    title: "Old table",
    meta: {
      catalog: {
        kind: "stored",
        tables: [
          {
            schema: "prior",
            name: "old_rows",
            columns: [{ name: "old", type: "string" }],
          },
        ],
      },
    },
  };
  source.readArtifact = async () => ({
    ...source.base,
    artifacts: [artifact],
    tables: { artifact_versions: [old] },
  });
  const admission = options.standaloneDatasetPages!;
  admission.heads = [
    {
      ...admission.heads[0]!,
      version: 5,
      artifactSha256: datasetPageArtifactSha256(artifact),
    },
  ];
  // Existing resource authority must remain exactly the reviewed current descriptor.
  const { planDatasetMetadata } = await import(
    "../src/migration/datasets/import-metadata.ts"
  );
  admission.base.inventory.resources = planDatasetMetadata({
    manifest: {
      ...source.base,
      artifacts: [artifact],
      tables: { ...source.base.tables, relations: [] },
    },
    maps: source.maps,
    receipts: source.datasets!.receipts,
    bindings: [],
    relationProvenance: {
      exportedAt: source.base.exportedAt,
      manifestSha256: "b".repeat(64),
    },
  }).metadata.resources;
  admission.history = {
    kind: "standalone-dataset-history-v1",
    revisions: [
      {
        legacyId: artifact.id,
        version: 3,
        artifactSha256: datasetPageArtifactSha256(old),
      },
    ],
  };
  const prepared = await prepareStandaloneDatasetJob(source, options, {
    host: standaloneDatasetHost,
  });
  source.preparedDatasets = prepared;
  assert.deepEqual(
    prepared.scan.pages[0]!.revisions.map((r) => r.version),
    [5, 3],
  );
  assert.deepEqual(
    prepared.metadata.versions.map((v) => v.version).sort(),
    [3, 5],
  );
  assert.equal(prepared.metadata.bindings.length, 2);
  const prior = prepared.standaloneDatasetSources!.get(
    JSON.stringify([artifact.id, 3]),
  )!;
  assert.equal(prior.kind, "stored");
  if (prior.kind === "stored")
    assert.equal(prior.binding.tables[0]!.table, "old_rows");
  const plan = await createMigrationJobPlanner(source, options, async () => {
    throw Error("unexpected markup");
  })(await source.readArtifact(artifact.id));
  assert.equal(plan.pages[0]!.disposition, "ready");
  assert.deepEqual(
    plan.pages[0]!.revisions.map((r) => r.version),
    [3, 5],
  );
  for (const revision of plan.pages[0]!.revisions)
    assert.ok(revision.conversion.html);
  assert.equal(plan.pages[0]!.original.version, 5);
});

test("additive version scope rejects unsealed and duplicate history identities", async () => {
  const { standaloneDatasetVersionScope } = await import(
    "../src/migration/dataset-pages/history.ts"
  );
  const { options } = standaloneDatasetFixture();
  const admission = options.standaloneDatasetPages!;
  const old = {
    legacyId: "data01",
    version: 2,
    artifactSha256: "a".repeat(64),
  };
  assert.equal(
    standaloneDatasetVersionScope(admission).has(JSON.stringify(["data01", 2])),
    false,
  );
  admission.history = {
    kind: "standalone-dataset-history-v1",
    revisions: [old],
  };
  assert.equal(
    standaloneDatasetVersionScope(admission).get(JSON.stringify(["data01", 2])),
    old.artifactSha256,
  );
  admission.history.revisions = [old, old];
  assert.throws(
    () => standaloneDatasetVersionScope(admission),
    /version scope/,
  );
  admission.history.revisions = [{ ...old, legacyId: "unsealed" }];
  assert.throws(
    () => standaloneDatasetVersionScope(admission),
    /version scope/,
  );
});

test("derived saved identity is explicit, raw-source-bound and never replaces an original edit id", async () => {
  const { standaloneDatasetEditIdentity, assertStandaloneDatasetEditIdentity } =
    await import("../src/migration/dataset-pages/history.ts");
  const row = {
    artifact_id: "data01",
    version: 3,
    format: "dataset",
    meta: {},
  };
  const derived = standaloneDatasetEditIdentity(row, true);
  assert.equal(derived.editIdentity, "source-version-sha256");
  assert.notEqual(
    derived.editId,
    standaloneDatasetEditIdentity({ ...row, version: 4 }, true).editId,
  );
  assert.notEqual(
    derived.editId,
    standaloneDatasetEditIdentity({ ...row, meta: { changed: true } }, true)
      .editId,
  );
  assert.throws(
    () =>
      assertStandaloneDatasetEditIdentity(row, true, {
        editId: derived.editId,
      }),
    /identity differs/,
  );
  assert.throws(
    () =>
      assertStandaloneDatasetEditIdentity(
        { ...row, edit_id: "original" },
        true,
        derived,
      ),
    /identity differs/,
  );
  assert.throws(
    () =>
      assertStandaloneDatasetEditIdentity(
        { ...row, version: 4 },
        true,
        derived,
      ),
    /identity differs/,
  );
  assert.throws(() => standaloneDatasetEditIdentity(row, false), /unavailable/);
  assert.deepEqual(
    standaloneDatasetEditIdentity({ ...row, edit_id: "original" }, true),
    { editId: "original" },
  );
});
