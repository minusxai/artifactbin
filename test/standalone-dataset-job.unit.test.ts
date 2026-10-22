import {
  standaloneDatasetFixture,
  standaloneDatasetHost,
} from "./support/standalone-dataset.ts";
import { createHash } from "node:crypto";
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
test("completed base resource projections are reused without introducing dataset write operations", async () => {
  const { source, options } = standaloneDatasetFixture();
  const original = await prepareMigrationJobDatasets(source, options, {
    host: standaloneDatasetHost,
  });
  const approved = {
    ...original!.metadata.resources[0]!,
    owner: "assigned@example.test",
  };
  options.standaloneDatasetPages!.base.inventory.resources = [approved];
  const prepared = await prepareMigrationJobDatasets(source, options, {
    host: standaloneDatasetHost,
  });
  assert.deepEqual(prepared!.metadata.resources, [approved]);
  assert.equal(prepared!.metadata.operations?.length ?? 0, 0);
});
test("external admission binds exact source and canonical declarations before compiling only the trusted query capability", async () => {
  const { artifact, source, options } = standaloneDatasetFixture(true);
  const sql = "SELECT 1 AS n";
  const query = {
    pageLegacyId: artifact.id,
    pageVersion: artifact.version,
    name: "table0",
    sourceRef: "ref:" + artifact.id,
    resource: "source-" + artifact.id,
    sql,
    sqlSha256: createHash("sha256").update(sql).digest("hex"),
    params: {},
    columns: [{ name: "n", type: "number" as const }],
  };
  options.standaloneDatasetPages!.external = [
    {
      legacyId: artifact.id,
      version: artifact.version,
      artifactSha256: options.standaloneDatasetPages!.heads[0]!.artifactSha256,
      declarations: `<Helmet><Query name="table0" source="ref:${artifact.id}">{${JSON.stringify(sql)}}</Query></Helmet>`,
      queries: [query],
    },
  ];
  options.sourceQueryRegistrations = [query];
  const prepared = await prepareMigrationJobDatasets(source, options, {
    host: standaloneDatasetHost,
  });
  assert.ok(prepared);
  assert.equal(prepared.issues.size, 0);
  const receipt = prepared.backends.get(artifact.id)![0]!;
  assert.equal(receipt.sourceQueries, true);
  assert.ok(receipt.standaloneExternalDataset);
  assert.equal(receipt.standaloneDataset, undefined);
  assert.equal(prepared.metadata.pages[0]!.snapshot.format, "dataset");
  assert.equal(
    prepared.metadata.pages[0]!.snapshot.standaloneDataset,
    undefined,
  );
  assert.equal(prepared.metadata.bindings.length, 0);
  assert.equal(prepared.sourceQueryRegistrations!.length, 1);
  options.standaloneDatasetPages!.external![0]!.declarations =
    options.standaloneDatasetPages!.external![0]!.declarations.replace(
      "SELECT 1",
      "SELECT 2",
    );
  await assert.rejects(
    () =>
      prepareMigrationJobDatasets(source, options, {
        host: standaloneDatasetHost,
      }),
    /declaration differs/,
  );
});
