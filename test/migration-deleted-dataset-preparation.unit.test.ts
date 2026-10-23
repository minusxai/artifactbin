import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  standaloneDatasetFixture,
  standaloneDatasetHost,
} from "./support/standalone-dataset.ts";
import { canonicalMigrationValue } from "../src/migration/verification-values.ts";
import {
  datasetPageArtifactSha256,
  scanStandaloneDatasetPages,
} from "../src/migration/dataset-pages/scan.ts";
import { additiveRowSha256 } from "../src/migration/dataset-pages/additive-authority.ts";
import { planDatasetMetadata } from "../src/migration/datasets/import-metadata.ts";
import { prepareMigrationJobDatasets } from "../src/migration/job-datasets.ts";
import type { DeletedArtifactAdmission } from "../src/migration/deleted-artifact-contracts.ts";
import type { LegacyArtifact } from "../src/migration/contracts.ts";
const sha = (row: unknown) =>
  createHash("sha256").update(canonicalMigrationValue(row)).digest("hex");
function seal(row: LegacyArtifact): DeletedArtifactAdmission {
  return {
    kind: "deleted-artifact-admission-v1",
    sourceNamespace: "fixture",
    archiveDigest: "a".repeat(64),
    entries: [
      {
        legacyId: row.id,
        pageId: "Data01",
        headVersion: row.version,
        deletedAt: String(row.deleted_at),
        artifactSha256: sha(row),
        revisions: [{ version: row.version, artifactSha256: sha(row) }],
      },
    ],
  };
}
function fixture() {
  const f = standaloneDatasetFixture();
  f.artifact.deleted_at = "2020-01-02T03:04:05Z";
  f.options.standaloneDatasetPages!.heads[0]!.artifactSha256 =
    datasetPageArtifactSha256(f.artifact);
  const input = {
    manifest: {
      ...f.source.base,
      tables: { ...f.source.base.tables, relations: [] },
      artifacts: [f.artifact],
    },
    maps: f.source.maps,
    receipts: f.source.datasets!.receipts,
    bindings: [],
    relationProvenance: {
      exportedAt: f.source.base.exportedAt,
      manifestSha256: "b".repeat(64),
    },
  };
  f.options.standaloneDatasetPages!.heads[0]!.resourceSha256 =
    additiveRowSha256(planDatasetMetadata(input).metadata.resources[0]);
  return { ...f, admission: seal(f.artifact), input };
}
test("deleted membership metadata accepts exact admission and retains security and deletion state", () => {
  const f = fixture();
  f.artifact.format = "markup";
  f.artifact.source = "<p>members</p>";
  f.artifact.meta = {};
  const input = {
    ...f.input,
    bindings: [],
    memberPages: [
      {
        pageLegacyId: f.artifact.id,
        pageId: "Data01",
        pageVersion: f.artifact.version,
      },
    ],
  };
  assert.throws(() => planDatasetMetadata(input), /member page provenance/);
  const admission = seal(f.artifact);
  assert.equal(
    planDatasetMetadata({ ...input, deletedAdmission: admission }).metadata
      .pages[0]!.snapshot.deleted,
    true,
  );
  const changed = structuredClone(admission);
  changed.entries[0]!.artifactSha256 = "f".repeat(64);
  assert.throws(
    () => planDatasetMetadata({ ...input, deletedAdmission: changed }),
    /Deleted artifact admission/,
  );
  assert.throws(
    () =>
      planDatasetMetadata({
        ...input,
        deletedAdmission: admission,
        memberPages: [{ ...input.memberPages[0]!, pageId: "Wrong1" }],
      }),
    /member page provenance/,
  );
});
test("all selected deleted input heads are verified before compiling ordinary metadata", async () => {
  const f = fixture();
  delete f.options.standaloneDatasetPages;
  f.artifact.format = "markup";
  f.artifact.source = "<p>plain</p>";
  f.artifact.meta = {};
  const admission = seal(f.artifact);
  const invalid = structuredClone(admission);
  invalid.entries[0]!.artifactSha256 = "f".repeat(64);
  await assert.rejects(
    prepareMigrationJobDatasets(
      f.source,
      f.options,
      { host: standaloneDatasetHost },
      invalid,
    ),
    /Deleted artifact admission/,
  );
  const result = await prepareMigrationJobDatasets(
    f.source,
    f.options,
    { host: standaloneDatasetHost },
    admission,
  );
  assert.equal(result!.issues.size, 0);
});

test("deleted preparation refuses altered history, duplicate identities and live heads before any host work", async () => {
  const f = fixture();
  delete f.options.standaloneDatasetPages;
  f.artifact.format = "markup";
  f.artifact.source = "<p>plain</p>";
  f.artifact.meta = {};
  const admission = seal(f.artifact);
  const read = f.source.readArtifact;
  f.source.readArtifact = async (id) => ({
    ...(await read(id)),
    tables: {
      artifact_versions: [
        { artifact_id: id, version: 2, format: "markup", source: "old" },
      ],
    },
  });
  await assert.rejects(
    prepareMigrationJobDatasets(f.source, f.options, {}, admission),
    /Deleted artifact admission/,
  );
  f.source.readArtifact = read;
  const duplicate = structuredClone(admission);
  duplicate.entries = [...duplicate.entries, duplicate.entries[0]!];
  await assert.rejects(
    prepareMigrationJobDatasets(f.source, f.options, {}, duplicate),
    /Deleted artifact admission/,
  );
  f.artifact.deleted_at = null;
  await assert.rejects(
    prepareMigrationJobDatasets(f.source, f.options, {}, admission),
    /Deleted artifact admission/,
  );
});

test("historical standalone dataset bindings attest the exact archived row before identity projection", () => {
  const f = fixture();
  f.artifact.version = 2;
  const old = {
    ...f.artifact,
    id: "archived-row",
    artifact_id: f.artifact.id,
    version: 1,
    edit_id: "old-edit",
  };
  const provenance = {
    sourceFormat: "dataset" as const,
    legacyId: f.artifact.id,
    pageId: "Data01",
    pageVersion: 1,
    editId: "old-edit",
    artifactSha256: datasetPageArtifactSha256(old),
  };
  const input = {
    ...f.input,
    deletedAdmission: seal(f.artifact),
    manifest: {
      ...f.input.manifest,
      tables: { ...f.input.manifest.tables, artifact_versions: [old] },
    },
    bindings: [
      {
        pageLegacyId: f.artifact.id,
        pageId: "Data01",
        pageVersion: 1,
        backendId: "Back01",
        backendVersion: "c".repeat(64),
        backendNamespace: "legacyData",
        name: "data",
        legacyRef: "ref:" + f.artifact.id,
        datasetLegacyId: f.artifact.id,
        datasetVersion: 1,
        standaloneDataset: provenance,
      },
    ],
  };
  const result = planDatasetMetadata(input);
  assert.equal(result.metadata.pages[0]!.pageVersion, 1);
  assert.equal(result.metadata.pages[0]!.snapshot.editId, "old-edit");
  assert.equal(result.metadata.pages[0]!.snapshot.deleted, true);
  const changed = structuredClone(input);
  changed.manifest.tables.artifact_versions![0]!.source = "tampered";
  assert.throws(
    () => planDatasetMetadata(changed),
    /standalone dataset provenance/,
  );
});
test("historical external dataset metadata requires exact archived provenance", () => {
  const f = fixture();
  f.artifact.version = 2;
  const old = {
    ...f.artifact,
    id: "old-external",
    artifact_id: f.artifact.id,
    version: 1,
    edit_id: "external-edit",
  };
  const provenance = {
    sourceFormat: "dataset" as const,
    legacyId: f.artifact.id,
    pageId: "Data01",
    pageVersion: 1,
    editId: "external-edit",
    artifactSha256: datasetPageArtifactSha256(old),
  };
  const input = {
    ...f.input,
    deletedAdmission: seal(f.artifact),
    manifest: {
      ...f.input.manifest,
      tables: { ...f.input.manifest.tables, artifact_versions: [old] },
    },
    sourceQueryPages: [
      {
        pageLegacyId: f.artifact.id,
        pageId: "Data01",
        pageVersion: 1,
        standaloneExternalDataset: provenance,
      },
    ],
  };
  assert.equal(
    planDatasetMetadata(input).metadata.pages[0]!.snapshot.editId,
    "external-edit",
  );
  const changed = structuredClone(input);
  changed.sourceQueryPages[0]!.standaloneExternalDataset.artifactSha256 =
    "f".repeat(64);
  assert.throws(
    () => planDatasetMetadata(changed),
    /standalone external provenance/,
  );
});

test("deleted program and source-query metadata require exact seals while preserving format gates", () => {
  for (const kind of ["program", "sourceQuery"] as const) {
    const f = fixture();
    f.artifact.format = kind === "program" ? "program" : "markup";
    f.artifact.meta = {};
    const page = {
      pageLegacyId: f.artifact.id,
      pageId: "Data01",
      pageVersion: 1,
    };
    const input = {
      ...f.input,
      ...(kind === "program"
        ? { programPages: [page] }
        : { sourceQueryPages: [page] }),
    };
    assert.throws(() => planDatasetMetadata(input), /member page provenance/);
    const result = planDatasetMetadata({
      ...input,
      deletedAdmission: seal(f.artifact),
    });
    assert.equal(result.metadata.pages[0]!.snapshot.deleted, true);
    f.artifact.format = "image";
    assert.throws(
      () =>
        planDatasetMetadata({ ...input, deletedAdmission: seal(f.artifact) }),
      /member page provenance/,
    );
  }
});

 test("deleted raw history accepts one exact head overlap but rejects conflicting or duplicate overlaps", async () => {
  const f = fixture();
  const {validateDeletedArtifactPreparation} = await import("../src/migration/deleted-artifact-admission.ts");
  const read = f.source.readArtifact;
  const overlap = {...f.artifact, artifact_id:f.artifact.id};
  f.source.readArtifact = async id => ({...(await read(id)), tables:{artifact_versions:[overlap]}});
  await validateDeletedArtifactPreparation(f.source,f.admission);
  overlap.source = "changed";
  await assert.rejects(validateDeletedArtifactPreparation(f.source,f.admission), /Deleted artifact admission/);
  overlap.source = f.artifact.source;
  f.source.readArtifact = async id => ({...(await read(id)), tables:{artifact_versions:[overlap,{...overlap}]}});
  await assert.rejects(validateDeletedArtifactPreparation(f.source,f.admission), /Deleted artifact admission/);
 });

test("standalone deleted dataset requires an exact explicit seal and preserves original lifecycle", async () => {
  const f = fixture();
  const original = structuredClone(f.artifact);
  await assert.rejects(
    scanStandaloneDatasetPages(f.source, f.options),
    /source changed/,
  );
  const prepared = await prepareMigrationJobDatasets(
    f.source,
    f.options,
    { host: standaloneDatasetHost },
    f.admission,
  );
  assert.equal(prepared!.issues.size, 0);
  assert.equal(prepared!.metadata.pages[0]!.snapshot.deleted, true);
  assert.equal(prepared!.metadata.resources[0]!.deleted, true);
  assert.deepEqual(f.artifact, original);
  for (const change of [
    (a: DeletedArtifactAdmission) => {
      a.entries[0]!.deletedAt = "2020-01-03T00:00:00Z";
    },
    (a: DeletedArtifactAdmission) => {
      a.entries[0]!.artifactSha256 = "f".repeat(64);
    },
    (a: DeletedArtifactAdmission) => {
      a.entries[0]!.pageId = "Wrong1";
    },
    (a: DeletedArtifactAdmission) => {
      a.sourceNamespace = "other";
    },
  ]) {
    const admission = structuredClone(f.admission);
    change(admission);
    await assert.rejects(
      prepareMigrationJobDatasets(
        f.source,
        f.options,
        { host: standaloneDatasetHost },
        admission,
      ),
      /Deleted artifact admission/,
    );
  }
});
