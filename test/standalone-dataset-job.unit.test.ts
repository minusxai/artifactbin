import {
  standaloneDatasetFixture,
  standaloneDatasetHost,
} from "./support/standalone-dataset.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareMigrationJobDatasets } from "../src/migration/job-datasets.ts";
import { createMigrationJobPlanner } from "../src/migration/job-planning.ts";
import { standaloneDatasetBackendSource } from "../src/migration/dataset-pages/backend.ts";
test("normal dataset preparation/planning creates its own read-only backend and preserves original source/policy provenance", async () => {
  const { artifact, source, options } = standaloneDatasetFixture();
  const prepared = await prepareMigrationJobDatasets(source, options, {
    host: standaloneDatasetHost,
  });
  assert.ok(prepared);
  source.preparedDatasets = prepared;
  const receipt = prepared.backends.get(artifact.id)![0]!;
  assert.equal(receipt.deployment.source, standaloneDatasetBackendSource);
  assert.notEqual(receipt.backendId, "Back01");
  assert.equal(prepared.metadata.operations?.length ?? 0, 0);
  assert.equal(prepared.metadata.pages[0]!.snapshot.format, "dataset");
  assert.equal(prepared.metadata.bindings[0]!.dataset.id, artifact.id);
  assert.equal(prepared.metadata.bindings[0]!.page.legacyId, artifact.id);
  assert.deepEqual(prepared.metadata.pages[0]!.snapshot.standaloneDataset, {
    kind: "dataset-self-read-v1",
    datasetId: artifact.id,
    version: 1,
  });
  const planner = createMigrationJobPlanner(source, options, async () => {
    throw Error("legacy dataset must not become fake markup input");
  });
  const plan = await planner(await source.readArtifact(artifact.id));
  assert.equal(plan.pages[0]!.disposition, "ready");
  const html = plan.pages[0]!.revisions[0]!.conversion.html!;
  assert.match(html, /af-backend/);
  assert.ok(html.includes(receipt.backendId));
  assert.ok(!html.includes("objectKey"));
  assert.equal(plan.pages[0]!.original.format, "dataset");
  const repeated = await prepareMigrationJobDatasets(source, options, {
    host: standaloneDatasetHost,
  });
  assert.deepEqual(repeated!.backends, prepared.backends);
});
test("external data cannot become ready without an explicit trusted source registration", async () => {
  const { artifact, source, options } = standaloneDatasetFixture(true);
  const prepared = await prepareMigrationJobDatasets(source, options, {
    host: standaloneDatasetHost,
  });
  assert.ok(prepared);
  source.preparedDatasets = prepared;
  assert.equal(prepared.backends.size, 0);
  assert.deepEqual(prepared.issues.get(artifact.id), [
    "external-registration-required",
  ]);
  const plan = await createMigrationJobPlanner(source, options, async () => {
    throw Error("not markup");
  })(await source.readArtifact(artifact.id));
  assert.equal(plan.pages[0]!.disposition, "blocked");
  assert.equal(plan.pages[0]!.revisions[0]!.conversion.html, null);
});
test("source changes, missing deleted/reserved IDs and mixed capability admission fail closed", async () => {
  const { artifact, source, options } = standaloneDatasetFixture();
  artifact.title = "changed";
  await assert.rejects(
    () =>
      prepareMigrationJobDatasets(source, options, {
        host: standaloneDatasetHost,
      }),
    /source changed/,
  );
  const fresh = standaloneDatasetFixture();
  fresh.options.standaloneDatasetPages!.reservedFileIds = ["Data01"];
  await assert.rejects(
    () =>
      prepareMigrationJobDatasets(fresh.source, fresh.options, {
        host: standaloneDatasetHost,
      }),
    /inventory incomplete/,
  );
});
test("relocating the reviewed report preserves backend allocation but changing its approved digest does not", async () => {
  const { source, options } = standaloneDatasetFixture();
  const first = await prepareMigrationJobDatasets(source, options, {
    host: standaloneDatasetHost,
  });
  options.standaloneDatasetPages!.base.verificationReport.path =
    "/relocated/verified.json";
  const relocated = await prepareMigrationJobDatasets(source, options, {
    host: standaloneDatasetHost,
  });
  assert.deepEqual(relocated!.allocation, first!.allocation);
  options.standaloneDatasetPages!.base.verificationReport.sha256 = "b".repeat(
    64,
  );
  const changed = await prepareMigrationJobDatasets(source, options, {
    host: standaloneDatasetHost,
  });
  assert.notDeepEqual(changed!.allocation, first!.allocation);
});
