import { planDatasetMetadata } from "../src/migration/datasets/import-metadata.ts";
import { additiveRowSha256 } from "../src/migration/dataset-pages/additive-authority.ts";
import { createStoredModelResolver } from "../src/persistence/dataset-stored-models.ts";
import { storedModelDependenciesSha256 } from "../src/datasets/stored-model/attestation.ts";
import {
  catalogVersion,
  receiptMap,
} from "../src/migration/datasets/catalog.ts";
import { datasetPageArtifactSha256 } from "../src/migration/dataset-pages/scan.ts";
import { createSourceQueryRepository } from "../src/persistence/source-queries.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { testDatabase } from "./postgres.js";
import {
  standaloneDatasetFixture,
  standaloneDatasetHost,
} from "./support/standalone-dataset.ts";
import { PostgresMigrationDestination } from "../src/migration/postgres.ts";
import { PostgresDatasetMetadataDestination } from "../src/migration/dataset-destination.ts";
import { verifyMigrationDatasetMetadata } from "../src/migration/dataset-verification.ts";
import {
  captureAdditiveDatasetBase,
  verifyAdditiveDatasetBase,
} from "../src/migration/dataset-pages/additive-authority.ts";
import { prepareMigrationJobDatasets } from "../src/migration/job-datasets.ts";
import { createMigrationJobPlanner } from "../src/migration/job-planning.ts";
import { applyMigration } from "../src/migration/import.ts";
import type { DatasetMigrationBatch } from "../src/migration/dataset-destination-contracts.ts";

for (const [existingResource, external, model, history] of [
  [true, false],
  [false, false],
  [true, true],
  [true, false, true],
  [true, false, false, true],
])
  test(`additive normal publication ${history ? "with saved history " : ""}${existingResource ? "reuses" : "introduces an approved original"} ${external ? "external " : model ? "stored model " : "stored "}resource, preserves base, replays and refuses changed authority`, async () => {
    const db = await testDatabase();
    const client = await db.pool.connect();
    const dir = await mkdtemp(join(tmpdir(), "dataset-additive-"));
    const { source, options } = standaloneDatasetFixture(external);
    if (history) {
      const originalRead = source.readArtifact;
      const artifact = (await originalRead("data01")).artifacts[0]!;
      artifact.version = 5;
      const prior = {
        ...artifact,
        id: "archive-record",
        artifact_id: artifact.id,
        version: 3,
        edit_id: undefined,
        title: "Prior table",
        meta: {
          catalog: {
            kind: "stored",
            tables: [
              {
                schema: "old",
                name: "prior_rows",
                columns: [{ name: "old_value", type: "string" }],
              },
            ],
          },
        },
      };
      source.readArtifact = async (id) => ({
        ...(await originalRead(id)),
        tables: { artifact_versions: [prior] },
      });
      options.standaloneDatasetPages!.heads[0]!.version = 5;
      options.standaloneDatasetPages!.heads[0]!.artifactSha256 =
        datasetPageArtifactSha256(artifact);
      options.standaloneDatasetPages!.heads[0]!.resourceSha256 =
        additiveRowSha256(
          planDatasetMetadata({
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
          }).metadata.resources[0],
        );
      options.standaloneDatasetPages!.history = {
        kind: "standalone-dataset-history-v1",
        revisions: [
          {
            legacyId: artifact.id,
            version: 3,
            artifactSha256: datasetPageArtifactSha256(prior),
          },
        ],
      };
    }
    if (model) {
      const artifact = (await source.readArtifact("data01")).artifacts[0]!;
      const catalog = (
        artifact.meta as { catalog: { tables: Record<string, unknown>[] } }
      ).catalog;
      const sql = "SELECT COUNT(*) AS n FROM public.rows";
      catalog.tables.push({
        schema: "public",
        name: "summary",
        columns: [{ name: "n", type: "number" }],
        sql,
      });
      const artifactSha256 = datasetPageArtifactSha256(artifact),
        version = catalogVersion(
          artifact,
          artifact.id,
          receiptMap(source.datasets!.receipts),
        );
      options.standaloneDatasetPages!.heads[0]!.artifactSha256 = artifactSha256;
      options.standaloneDatasetPages!.models = [
        {
          legacyId: artifact.id,
          version: artifact.version,
          artifactSha256,
          attestations: [
            {
              schema: "public",
              table: "summary",
              columns: [{ name: "n", type: "number" }],
              modelSqlSha256: createHash("sha256").update(sql).digest("hex"),
              sourceArtifactSha256: artifactSha256,
              dependencyDescriptorSha256: storedModelDependenciesSha256(
                version.tables,
              ),
            },
          ],
        },
      ];
    }
    if (external) {
      const artifact = (await source.readArtifact("data01")).artifacts[0]!;
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
          artifactSha256:
            options.standaloneDatasetPages!.heads[0]!.artifactSha256,
          declarations: `<Helmet><Query name="table0" source="ref:${artifact.id}">{${JSON.stringify(sql)}}</Query></Helmet>`,
          queries: [query],
        },
      ];
      options.sourceQueryRegistrations = [query];
    }
    options.schema = db.schema;
    const destination = new PostgresMigrationDestination(client, {
      schema: db.schema,
      sourceNamespace: "fixture",
      isolated: true,
      editorManageRestricted: true,
      origin: options.origin,
    });
    try {
      await destination.prepare({ manifest: source.base, maps: source.maps });
      const metadata = new PostgresDatasetMetadataDestination(
        client,
        db.schema,
        undefined,
        options.sourceQueryRegistrations,
      );
      const base: DatasetMigrationBatch = {
        ...source.datasets!.provenance,
        metadata: {
          sourceNamespace: "fixture",
          bindings: [],
          pages: [],
          resources: [],
          versions: [],
          principals: [
            {
              kind: "user",
              legacyId: "owner",
              actor: "owner@example.test",
              identity: "user",
              expiresAt: null,
            },
          ],
          groups: [],
          acceptedJoins: [],
        },
      };
      const originalDataset = await prepareMigrationJobDatasets(
        source,
        options,
        {
          host: standaloneDatasetHost,
        },
      );
      if (existingResource) {
        base.metadata.resources = originalDataset!.metadata.resources;
        base.metadata.versions = originalDataset!.metadata.versions;
      }
      await metadata.import(base);
      await verifyMigrationDatasetMetadata(client, db.schema, base);
      const original = (
        await client.query(
          `SELECT * FROM "${db.schema}_migration".dataset_receipts`,
        )
      ).rows;
      const report = {
        complete: true,
        readOnly: true,
        compilerIdentity: "fixture",
        runtime: { pages: 0 },
        archives: [
          { manifestSha256: base.baseManifestSha256 },
          { manifestSha256: base.relationManifestSha256 },
        ],
      };
      const bytes = JSON.stringify(report);
      const path = join(dir, "verified.json");
      await writeFile(path, bytes);
      options.standaloneDatasetPages!.base = await captureAdditiveDatasetBase(
        client,
        db.schema,
        base,
        { path, sha256: createHash("sha256").update(bytes).digest("hex") },
      );
      const prepared = await prepareMigrationJobDatasets(source, options, {
        host: standaloneDatasetHost,
      });
      assert.ok(prepared);
      source.preparedDatasets = prepared;
      const plan = await createMigrationJobPlanner(
        source,
        options,
        async () => {
          throw Error("not legacy markup");
        },
      )(await source.readArtifact("data01"));
      await assert.rejects(
        () =>
          verifyAdditiveDatasetBase(client, db.schema, {
            ...base,
            additive: options.standaloneDatasetPages,
            sourceQueryRegistrations: prepared.sourceQueryRegistrations,
            metadata: {
              ...prepared.metadata,
              resources: prepared.metadata.resources.map((r) => ({
                ...r,
                generation: r.generation + 1,
              })),
            },
          }),
        /attempted base replacement|descriptor/,
      );
      if (history) {
        await assert.rejects(
          () =>
            verifyAdditiveDatasetBase(client, db.schema, {
              ...base,
              additive: options.standaloneDatasetPages,
              metadata: {
                ...prepared.metadata,
                pages: prepared.metadata.pages.map((p) => ({
                  ...p,
                  pageVersion: 99,
                })),
              },
            }),
          /self reads/,
        );
        assert.equal(plan.pages[0]!.disposition, "ready");
        assert.deepEqual(
          plan.pages[0]!.revisions.map((r) => r.version),
          [3, 5],
        );
        assert.ok(plan.pages[0]!.revisions.every((r) => r.conversion.html));
        assert.deepEqual(
          prepared.metadata.bindings.map((b) => b.page.version).sort(),
          [3, 5],
        );
        assert.equal(
          prepared.metadata.versions.find((v) => v.version === 3)!.tables[0]!
            .name,
          "prior_rows",
        );
      }
      const result = await applyMigration(plan, destination, { dryRun: false });
      assert.equal(result.created, 1);
      const batch: DatasetMigrationBatch = {
        ...base,
        metadata: prepared.metadata,
        additive: options.standaloneDatasetPages,
        sourceQueryRegistrations: prepared.sourceQueryRegistrations,
      };
      const added = await metadata.import(batch);
      assert.ok(added.created > 0);
      assert.equal((await metadata.import(batch)).created, 0);
      const relocated = join(dir, "relocated-verification.json");
      await writeFile(relocated, bytes);
      options.standaloneDatasetPages!.base.verificationReport.path = relocated;
      assert.equal((await metadata.import(batch)).created, 0);
      options.standaloneDatasetPages!.base.verificationReport.path = path;
      assert.ok(
        (await verifyMigrationDatasetMetadata(
          client,
          db.schema,
          batch,
          undefined,
          options.sourceQueryRegistrations,
        )) > 0,
      );
      assert.deepEqual(
        (
          await client.query(
            `SELECT * FROM "${db.schema}_migration".dataset_receipts`,
          )
        ).rows,
        original,
      );
      const receiptRows = (
        await client.query(
          `SELECT * FROM "${db.schema}_migration".dataset_additive_receipts`,
        )
      ).rows;
      assert.equal(receiptRows.length, 1);
      if (model) {
        const resolver = createStoredModelResolver({
            transaction: async (work) => work(client),
          }),
          binding = prepared.metadata.bindings[0]!,
          resource = prepared.metadata.resources[0]!;
        const resolved = {
            ...binding,
            revision: {
              version: resource.currentVersion,
              generation: resource.generation,
              policyRevision: resource.policyRevision,
            },
          },
          context = {
            backendId: binding.backendId,
            backendVersion: binding.backendVersion,
            pageId: binding.page.id,
            subject: "owner@example.test",
          };
        const registered = await resolver(context, resolved, {
          schema: "public",
          table: "summary",
        });
        assert.equal(registered?.sql, "SELECT COUNT(*) AS n FROM public.rows");
        assert.deepEqual(registered?.dependencies, binding.tables);
        assert.equal(
          await resolver(
            { ...context, backendVersion: "0".repeat(64) },
            resolved,
            { schema: "public", table: "summary" },
          ),
          null,
        );
        await assert.rejects(
          () =>
            client.query(
              `UPDATE "${db.schema}".dataset_pages SET snapshot=jsonb_set(snapshot,'{standaloneDataset,models,0,modelSqlSha256}',to_jsonb($1::text))`,
              ["0".repeat(64)],
            ),
          /immutable/,
        );
        assert.ok(
          await resolver(context, resolved, {
            schema: "public",
            table: "summary",
          }),
        );
        const withoutModels = {
          ...batch,
          additive: { ...batch.additive!, models: [] },
        };
        await assert.rejects(
          () => verifyAdditiveDatasetBase(client, db.schema, withoutModels),
          /exact stored model admission/,
        );
      }
      await assert.rejects(
        () =>
          metadata.import({
            ...batch,
            metadata: {
              ...batch.metadata,
              resources: batch.metadata.resources.map((r) => ({
                ...r,
                generation: r.generation + 1,
              })),
            },
          }),
        /differs|changed|Unexpected|approved/,
      );
      await client.query(
        `UPDATE "${db.schema}".dataset_principals SET expires_at='2000-01-01' WHERE kind='user'`,
      );
      await assert.rejects(() => metadata.import(batch), /base changed/);
      await client.query(
        `UPDATE "${db.schema}".dataset_principals SET expires_at=NULL WHERE kind='user'`,
      );
      if (external) {
        const receipt = prepared.sourceQueryRegistrations![0]!.receipt;
        const repository = createSourceQueryRepository(
          { transaction: async (work) => work(client) },
          () => undefined,
        );
        const context = {
          backendId: receipt.backendId,
          backendVersion: receipt.deployment.version,
          pageId: receipt.pageId,
          subject: "owner@example.test",
        };
        assert.ok(await repository.authority(context));
        await assert.rejects(
          () =>
            client.query(`DELETE FROM "${db.schema}".dataset_source_queries`),
          /immutable/,
        );
        await client.query(
          `DELETE FROM "${db.schema}".dataset_viewer_bindings`,
        );
        assert.equal(await repository.authority(context), null);
      } else await client.query(`DELETE FROM "${db.schema}".dataset_bindings`);
      await assert.rejects(
        () => metadata.import(batch),
        /removed after import|Source query requires exact/,
      );
      await writeFile(path, JSON.stringify({ ...report, complete: false }));
      await assert.rejects(
        () => verifyAdditiveDatasetBase(client, db.schema, batch),
        /report changed/,
      );
    } finally {
      await client.query(
        `DROP SCHEMA IF EXISTS "${db.schema}_migration" CASCADE`,
      );
      client.release();
      await db.cleanup();
      await rm(dir, { recursive: true, force: true });
    }
  });
