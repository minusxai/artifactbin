import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { testDatabase } from "./postgres.js";
import { standaloneDatasetFixture } from "./support/standalone-dataset.ts";
import { PostgresMigrationDestination } from "../src/migration/postgres.ts";
import { PostgresDatasetMetadataDestination } from "../src/migration/dataset-destination.ts";
import {
  captureAdditiveDatasetBase,
  additiveRowSha256,
} from "../src/migration/dataset-pages/additive-authority.ts";
import { createMigrationJobPlanner } from "../src/migration/job-planning.ts";
import { applyMigration } from "../src/migration/import.ts";
import {
  verifyStandaloneVizBase,
  recordStandaloneVizReceipt,
  verifyStandaloneVizReceipt,
} from "../src/migration/viz-pages/authority.ts";
import type { DatasetMigrationBatch } from "../src/migration/dataset-destination-contracts.ts";
import type { StandaloneVizJobAdmission } from "../src/migration/viz-pages/admission-contracts.ts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
test("viz normal publication preserves ACL/history, replays, and rejects edited content or changed base", async () => {
  const db = await testDatabase(),
    client = await db.pool.connect(),
    dir = await mkdtemp(join(tmpdir(), "viz-additive-"));
  const { source, options } = standaloneDatasetFixture();
  options.schema = db.schema;
  delete options.standaloneDatasetPages;
  source.maps.pages = { recipe: "Rcp123" };
  source.ids = ["recipe"];
  const raw = (await source.readArtifact("data01")).artifacts[0]!;
  const row = {
    ...raw,
    id: "recipe",
    format: "viz",
    version: 2,
    source: JSON.stringify({
      description: "Recipe",
      engine: "vega-lite",
      bindings: [{ name: "x", label: "X", accepts: ["nominal"] }],
      template: {
        mark: "bar",
        encoding: { x: { field: "{{x}}", type: "{{x:kind}}" } },
      },
    }),
    meta: null,
  };
  const old = {
    ...row,
    id: "old",
    artifact_id: "recipe",
    version: 1,
    source: row.source + " ",
  };
  source.readArtifact = async () => ({
    ...source.base,
    artifacts: [row],
    tables: { artifact_versions: [old] },
  });
  const destination = new PostgresMigrationDestination(client, {
    schema: db.schema,
    sourceNamespace: "fixture",
    isolated: true,
    editorManageRestricted: true,
    origin: options.origin,
  });
  try {
    await destination.prepare({ manifest: source.base, maps: source.maps });
    const batch: DatasetMigrationBatch = {
      ...source.datasets!.provenance,
      metadata: {
        sourceNamespace: "fixture",
        resources: [],
        versions: [],
        bindings: [],
        pages: [],
        principals: [],
        groups: [],
        acceptedJoins: [],
      },
    };
    await new PostgresDatasetMetadataDestination(client, db.schema).import(
      batch,
    );
    const bytes = JSON.stringify({
      complete: true,
      readOnly: true,
      compilerIdentity: "fixture",
      runtime: { pages: 0 },
      archives: [
        { manifestSha256: batch.baseManifestSha256 },
        { manifestSha256: batch.relationManifestSha256 },
      ],
    });
    const path = join(dir, "verified.json");
    await writeFile(path, bytes);
    const base = await captureAdditiveDatasetBase(client, db.schema, batch, {
      path,
      sha256: sha(bytes),
    });
    const admission: StandaloneVizJobAdmission = {
      kind: "standalone-viz-pages-v1",
      sourceNamespace: "fixture",
      base,
      heads: [
        {
          legacyId: "recipe",
          pageId: "Rcp123",
          version: 2,
          artifactSha256: additiveRowSha256(row),
          sourceSha256: sha(row.source),
          versions: [
            { version: 1, artifactSha256: additiveRowSha256(old) },
            { version: 2, artifactSha256: additiveRowSha256(row) },
          ],
        },
      ],
    };
    options.standaloneVizPages = { admission, baseInputs: { batch } };
    const planner = createMigrationJobPlanner(source, options, () => {
      throw Error("Unexpected markup compiler");
    });
    const plan = await planner(await source.readArtifact("recipe"));
    assert.equal(plan.pages[0]!.disposition, "ready");
    assert.equal(plan.pages[0]!.original.format, "viz");
    assert.equal(plan.pages[0]!.access.visibility, "private");
    assert.deepEqual(
      plan.pages[0]!.revisions.map((r) => r.version),
      [1, 2],
    );
    await verifyStandaloneVizBase(
      client,
      db.schema,
      admission,
      { batch },
      plan.pages,
      source.maps,
      options.origin,
    );
    assert.equal(
      (await applyMigration(plan, destination, { dryRun: false })).created,
      1,
    );
    await verifyStandaloneVizBase(
      client,
      db.schema,
      admission,
      { batch },
      plan.pages,
      source.maps,
      options.origin,
    );
    await recordStandaloneVizReceipt(client, db.schema, admission, plan.pages);
    assert.equal(
      (await applyMigration(plan, destination, { dryRun: false })).unchanged,
      1,
    );
    await recordStandaloneVizReceipt(client, db.schema, admission, plan.pages);
    assert.equal(
      (
        await client.query(
          `SELECT count(*)::int AS n FROM "${db.schema}_migration".viz_additive_receipts`,
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await client.query(
          `SELECT count(*)::int AS n FROM "${db.schema}".dataset_resources`,
        )
      ).rows[0].n,
      0,
    );
    await client.query(
      `UPDATE "${db.schema}_migration".viz_additive_receipts SET digest='changed'`,
    );
    await assert.rejects(
      () =>
        verifyStandaloneVizReceipt(client, db.schema, admission, plan.pages),
      /receipt missing or changed/,
    );
    await client.query(
      `DELETE FROM "${db.schema}_migration".viz_additive_receipts`,
    );
    await recordStandaloneVizReceipt(client, db.schema, admission, plan.pages);
    await client.query(
      `UPDATE "${db.schema}".files SET access=jsonb_set(access,'{visibility}','"public"') WHERE id='Rcp123'`,
    );
    await assert.rejects(() =>
      verifyStandaloneVizBase(
        client,
        db.schema,
        admission,
        { batch },
        plan.pages,
        source.maps,
        options.origin,
      ),
    );
    await client.query(
      `UPDATE "${db.schema}".files SET access=jsonb_set(access,'{visibility}','"private"') WHERE id='Rcp123'`,
    );
    await client.query(
      `INSERT INTO "${db.schema}".file_ids(id,owner,created_at) VALUES('Other1','owner@example.test',1)`,
    );
    await assert.rejects(
      () =>
        verifyStandaloneVizBase(
          client,
          db.schema,
          admission,
          { batch },
          plan.pages,
          source.maps,
          options.origin,
        ),
      /base facts changed/,
    );
    await client.query(`DELETE FROM "${db.schema}".file_ids WHERE id='Other1'`);
    await client.query(
      `UPDATE "${db.schema}_migration".dataset_receipts SET fingerprint='changed'`,
    );
    await assert.rejects(
      () =>
        verifyStandaloneVizBase(
          client,
          db.schema,
          admission,
          { batch },
          plan.pages,
          source.maps,
          options.origin,
        ),
      /base facts changed/,
    );
  } finally {
    client.release();
    await db.cleanup();
    await rm(dir, { recursive: true, force: true });
  }
});
