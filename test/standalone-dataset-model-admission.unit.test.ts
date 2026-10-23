import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { attestStandaloneDatasetModels } from "../src/migration/dataset-pages/models.ts";
import { standaloneDatasetFixture } from "./support/standalone-dataset.ts";
import {
  catalogVersion,
  receiptMap,
} from "../src/migration/datasets/catalog.ts";
import { datasetPageArtifactSha256 } from "../src/migration/dataset-pages/scan.ts";
import { storedModelDependenciesSha256 } from "../src/datasets/stored-model/attestation.ts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
async function fixture() {
  const { source } = standaloneDatasetFixture(),
    row = (await source.readArtifact("data01")).artifacts[0]!;
  const catalog = (
    row.meta as { catalog: { tables: Record<string, unknown>[] } }
  ).catalog;
  const sql = "SELECT COUNT(*) AS n FROM public.rows";
  catalog.tables.push({
    schema: "public",
    name: "summary",
    columns: [{ name: "n", type: "number" }],
    sql,
  });
  const version = catalogVersion(
      row,
      row.id,
      receiptMap(source.datasets!.receipts),
    ),
    artifactSha256 = datasetPageArtifactSha256(row);
  return {
    row,
    version,
    approved: [
      {
        schema: "public",
        table: "summary",
        columns: [{ name: "n", type: "number" as const }],
        modelSqlSha256: sha(sql),
        sourceArtifactSha256: artifactSha256,
        dependencyDescriptorSha256: storedModelDependenciesSha256(
          version.tables,
        ),
      },
    ],
  };
}
test("stored model admission binds exact original SQL, source, columns and physical object descriptors", async () => {
  const f = await fixture();
  assert.deepEqual(
    attestStandaloneDatasetModels(f.row, f.version, f.approved),
    f.approved,
  );
  for (const mutate of [
    (x: typeof f) => {
      x.approved[0]!.modelSqlSha256 = "0".repeat(64);
    },
    (x: typeof f) => {
      x.approved[0]!.sourceArtifactSha256 = "0".repeat(64);
    },
    (x: typeof f) => {
      x.version.tables[0]!.object.bytes++;
    },
    (x: typeof f) => {
      x.approved[0]!.columns[0]!.name = "other";
    },
  ]) {
    const changed = await fixture();
    mutate(changed);
    assert.throws(() =>
      attestStandaloneDatasetModels(
        changed.row,
        changed.version,
        changed.approved,
      ),
    );
  }
});
test("stored models require exact explicit admission and never auto-authorize catalog SQL", async () => {
  const f = await fixture();
  assert.throws(() => attestStandaloneDatasetModels(f.row, f.version, []));
  assert.throws(() =>
    attestStandaloneDatasetModels(f.row, f.version, [
      ...f.approved,
      ...f.approved,
    ]),
  );
});

test("normal standalone preparation publishes only attested model metadata and safe browser columns", async () => {
  const { source, options } = standaloneDatasetFixture();
  const row = (await source.readArtifact("data01")).artifacts[0]!,
    catalog = (row.meta as { catalog: { tables: Record<string, unknown>[] } })
      .catalog;
  const sql = "SELECT COUNT(*) AS n FROM public.rows";
  catalog.tables.push({
    schema: "public",
    name: "summary",
    columns: [{ name: "n", type: "number" }],
    sql,
  });
  const version = catalogVersion(
      row,
      row.id,
      receiptMap(source.datasets!.receipts),
    ),
    artifactSha256 = datasetPageArtifactSha256(row);
  options.standaloneDatasetPages!.heads[0]!.artifactSha256 = artifactSha256;
  const { prepareMigrationJobDatasets } = await import(
    "../src/migration/job-datasets.ts"
  );
  const { standaloneDatasetHost } = await import(
    "./support/standalone-dataset.ts"
  );
  const blocked = await prepareMigrationJobDatasets(source, options, {
    host: standaloneDatasetHost,
  });
  assert.deepEqual(blocked!.issues.get(row.id), [
    "dataset-source-registration-required",
  ]);
  const attestations = [
    {
      schema: "public",
      table: "summary",
      columns: [{ name: "n", type: "number" as const }],
      modelSqlSha256: sha(sql),
      sourceArtifactSha256: artifactSha256,
      dependencyDescriptorSha256: storedModelDependenciesSha256(version.tables),
    },
  ];
  options.standaloneDatasetPages!.models = [
    { legacyId: row.id, version: row.version, artifactSha256, attestations },
  ];
  const prepared = await prepareMigrationJobDatasets(source, options, {
    host: standaloneDatasetHost,
  });
  assert.equal(prepared!.issues.size, 0);
  const page = prepared!.metadata.pages[0]!;
  assert.equal(page.snapshot.format, "dataset");
  assert.deepEqual(page.snapshot.standaloneDataset!.models, attestations);
  const binding = [...prepared!.standaloneDatasetSources!.values()][0]!;
  assert.equal(binding.kind, "stored");
  if (binding.kind === "stored")
    assert.deepEqual(
      binding.binding.tables.map((t) => t.table),
      ["rows", "summary"],
    );
  assert.equal(JSON.stringify(binding).includes(sql), false);
  assert.equal(JSON.stringify(binding).includes("objectKey"), false);
  options.standaloneDatasetPages!.models[0]!.attestations[0]!.dependencyDescriptorSha256 =
    "0".repeat(64);
  await assert.rejects(
    () =>
      prepareMigrationJobDatasets(source, options, {
        host: standaloneDatasetHost,
      }),
    /dependencies changed/,
  );
});

test("saved model admission uses original archive identity and raw version source digest", async () => {
  const f = await fixture();
  const row = {
    ...f.row,
    id: "archive-row",
    artifact_id: f.row.id,
    version: 3,
    edit_id: undefined,
  };
  const version = { ...f.version, version: 3 };
  const approved = f.approved.map((a) => ({
    ...a,
    sourceArtifactSha256: datasetPageArtifactSha256(row),
  }));
  assert.deepEqual(
    attestStandaloneDatasetModels(row, version, approved),
    approved,
  );
  assert.throws(
    () => attestStandaloneDatasetModels(row, version, f.approved),
    /changed/,
  );
  assert.throws(
    () =>
      attestStandaloneDatasetModels(
        { ...row, artifact_id: "another" },
        version,
        approved,
      ),
    /identity/,
  );
});
