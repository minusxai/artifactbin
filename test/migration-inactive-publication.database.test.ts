import { registerMigrationDatasetAttachments } from "../src/migration/attachment-registration.ts";
import { deletedDatasetBatchFingerprint } from "../src/migration/deleted-dataset-authority.ts";
import type { DatasetMigrationBatch } from "../src/migration/dataset-destination-contracts.ts";
// @requires migration-database
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixture, binding, context } from "./dataset-runtime-fixture.ts";
import { createSqlDatabase } from "../src/persistence/sql.ts";
import {
  registerMigrationViewerBinding,
  registerInactiveMigrationViewerBinding,
} from "../src/migration/viewer-registration.ts";
import { assertDeletedMigrationPublication } from "../src/migration/inactive-publication.ts";
import {
  registerDatasetAttachments,
  registerInactiveDatasetAttachments,
  createDatasetAttachmentRepository,
} from "../src/persistence/dataset-attachments.ts";
import { loadDatasetViewer } from "../src/persistence/dataset-viewer.ts";
import { canonicalMigrationValue } from "../src/migration/verification-values.ts";
import type { DeletedMigrationPublicationContext } from "../src/migration/inactive-publication-contracts.ts";
import { prepareDeletedArtifactPlan } from "../src/migration/deleted-artifact-plan.ts";
import { validateDeletedArtifactReplay } from "../src/migration/deleted-artifact-replay.ts";
import { applyDeletedArtifactReplay } from "../src/migration/deleted-artifact-apply.ts";
import { serializeDeletedArtifactReplayPage } from "../src/migration/deleted-artifact-replay.ts";
test("inactive publication preserves deletion, requires exact raw/head evidence, retries and restores under current ACL", async () => {
  const { env } = await fixture(),
    client = await env.pool.connect();
  const deletedAt = "2026-01-01T00:00:00.000Z",
    original = {
      id: "old-page",
      version: 1,
      deleted_at: deletedAt,
      format: "markup",
      source: "original",
      user_id: "owner",
      group_id: null,
      token_id: null,
      document: null,
      visibility: "private",
      link_role: "viewer",
    },
    sha = (v: unknown) =>
      createHash("sha256").update(canonicalMigrationValue(v)).digest("hex");
  const p: DeletedMigrationPublicationContext = {
    kind: "deleted-migration-publication-v1",
    schema: env.schema,
    sourceNamespace: "legacy",
    archiveDigest: "a".repeat(64),
    admissionSha256: "b".repeat(64),
    legacyId: "old-page",
    pageId: "Pg0001",
    headVersion: 1,
    deletedAt,
    artifactSha256: sha(original),
  };
  const viewer = { ...context, pageVersion: 1, sourceNamespace: "legacy" };
  const reg = {
    backendNamespace: "bridge",
    sourceNamespace: "legacy",
    binding,
    acceptedTypes: ["image/png" as const],
  };
  try {
    await client.query(
      `CREATE SCHEMA ${env.schema}_migration; CREATE TABLE ${env.schema}_migration.archives(namespace text,digest text,manifest jsonb,maps jsonb)`,
    );
    await client.query(
      `INSERT INTO ${env.schema}_migration.archives VALUES('legacy',$1,$2,$3)`,
      [
        p.archiveDigest,
        { artifacts: [original] },
        { pages: { "old-page": "Pg0001" } },
      ],
    );
    await client.query(
      "INSERT INTO sources(file_id,revision,content) VALUES('Pg0001','1','converted')",
    );
    await client.query("UPDATE files SET deleted_at=$1", [
      Date.parse(deletedAt),
    ]);
    await assert.rejects(registerMigrationViewerBinding(client, viewer));
    await assert.rejects(
      registerDatasetAttachments({ client, registrations: [reg] }),
    );
    await assert.rejects(
      assertDeletedMigrationPublication(
        client,
        { ...p, artifactSha256: "c".repeat(64) },
        viewer,
      ),
    );
    await assert.rejects(
      assertDeletedMigrationPublication(
        client,
        { ...p, headVersion: 2 },
        viewer,
      ),
    );
    await assert.rejects(
      assertDeletedMigrationPublication(
        client,
        { ...p, deletedAt: "2026-01-02T00:00:00Z" },
        viewer,
      ),
    );
    // The planning projection may omit this page; its authentic original remains in raw archive parts.
    const part = {
      table: "artifacts",
      path: "artifacts/part.ndjson",
      rows: 2,
      bytes: 512,
      sha256: "d".repeat(64),
    };
    await client.query(`CREATE TABLE ${env.schema}_migration.stream_manifests(namespace text PRIMARY KEY,kind text,digest text,manifest jsonb);
      CREATE TABLE ${env.schema}_migration.stream_parts(namespace text,path text,source_table text,digest text,rows bigint,bytes bigint,PRIMARY KEY(namespace,path));
      CREATE TABLE ${env.schema}_migration.stream_rows(namespace text,path text,ordinal bigint,record jsonb,PRIMARY KEY(namespace,path,ordinal))`);
    await client.query(
      `INSERT INTO ${env.schema}_migration.stream_manifests VALUES($1,'base',$2,$3)`,
      [
        "legacy",
        "e".repeat(64),
        { schemaVersion: 2, sourceNamespace: "legacy", parts: [part] },
      ],
    );
    await client.query(
      `INSERT INTO ${env.schema}_migration.stream_parts VALUES($1,$2,$3,$4,$5,$6)`,
      ["legacy", part.path, part.table, part.sha256, part.rows, part.bytes],
    );
    await client.query(
      `INSERT INTO ${env.schema}_migration.stream_rows VALUES($1,$2,0,$3)`,
      ["legacy", part.path, original],
    );
    await client.query(
      `UPDATE ${env.schema}_migration.archives SET manifest=$1`,
      [{ artifacts: [{ id: "unrelated" }] }],
    );
    for (const wrong of [
      { ...p, artifactSha256: "f".repeat(64) },
      { ...p, archiveDigest: "f".repeat(64) },
      { ...p, deletedAt: "2026-01-02T00:00:00Z" },
    ])
      await assert.rejects(
        assertDeletedMigrationPublication(client, wrong, viewer),
      );
    await registerInactiveMigrationViewerBinding(client, viewer, p);
    const publication = await assertDeletedMigrationPublication(
      client,
      p,
      viewer,
    );
    await registerInactiveDatasetAttachments({
      client,
      registrations: [reg],
      publication,
    });
    const batch: DatasetMigrationBatch = {
      baseManifestSha256: "a".repeat(64),
      relationManifestSha256: "b".repeat(64),
      relationExportedAt: "epoch",
      metadata: {
        sourceNamespace: "legacy",
        bindings: [],
        resources: [],
        versions: [],
        principals: [],
        groups: [],
        acceptedJoins: [],
        attachments: [reg],
        pages: [
          {
            pageId: "Pg0001",
            pageVersion: 1,
            snapshot: {
              id: "old-page",
              editId: "old-edit",
              format: "markup",
              deleted: true,
              visibility: "private",
              owner: { userId: "old-owner", tokenId: null },
              ownerIsTestUser: false,
              acceptedJoinUserIds: [],
            },
          },
        ],
      },
    };
    batch.deletedAdditive = {
      kind: "deleted-dataset-additive-v1",
      sourceNamespace: "legacy",
      batchSha256: deletedDatasetBatchFingerprint(batch),
      admitted: [
        {
          legacyId: "old-page",
          pageId: "Pg0001",
          version: 1,
          artifactSha256: sha(original),
        },
      ],
      base: {
        verificationReport: { path: "offline", sha256: "c".repeat(64) },
        inventory: {
          sourceNamespace: "legacy",
          datasetFingerprint: "d".repeat(64),
          resources: [],
          baseManifestSha256: batch.baseManifestSha256,
          relationManifestSha256: batch.relationManifestSha256,
          relationExportedAt: batch.relationExportedAt,
          compilerIdentity: "fixture",
          reservedFileIds: [],
          protectedRows: [],
          backendRows: [],
          pageReceipts: [],
          sources: [],
          tables: [],
        },
      },
    };
    await registerMigrationDatasetAttachments(client, env.schema, batch);
    await registerMigrationDatasetAttachments(client, env.schema, batch);
    const wrong = structuredClone(batch);
    wrong.deletedAdditive!.admitted[0]!.artifactSha256 = "f".repeat(64);
    await assert.rejects(
      registerMigrationDatasetAttachments(client, env.schema, wrong),
    );
    const page = {
      legacyId: "old-page",
      pageId: "Pg0001",
      owner: { kind: "user" as const, id: "old-owner" },
      disposition: "ready" as const,
      issues: [],
      original,
      access: { visibility: "private", linkRole: "viewer", shares: [] },
      comments: [],
      identities: [],
      revisions: [
        {
          version: 1,
          original,
          conversion: {
            classification: "functional" as const,
            html: "<html><body>saved</body></html>",
            issues: [],
            identities: {},
          },
        },
      ],
    };
    const canonicalSha = (value: unknown) =>
      createHash("sha256").update(canonicalMigrationValue(value)).digest("hex");
    const admission = {
      kind: "deleted-artifact-admission-v1" as const,
      sourceNamespace: "legacy",
      archiveDigest: p.archiveDigest,
      entries: [
        {
          legacyId: "old-page",
          pageId: "Pg0001",
          headVersion: 1,
          deletedAt,
          artifactSha256: p.artifactSha256,
          revisions: [{ version: 1, artifactSha256: p.artifactSha256 }],
        },
      ],
    };
    const planned = prepareDeletedArtifactPlan({
      admission,
      pages: [page],
      protectedPageIds: new Set(),
    });
    const persistedEntry = planned.pages[0]!;
    const persistedBytes = Buffer.from(
      serializeDeletedArtifactReplayPage(persistedEntry),
    );
    const replayManifest = {
      kind: "deleted-artifact-replay-plan-v1" as const,
      sourceNamespace: planned.sourceNamespace,
      archiveDigest: planned.archiveDigest,
      admissionSha256: planned.admissionSha256,
      pageCount: 1,
      revisionCount: 1,
      canonicalPlanSha256: canonicalSha({
        ...planned,
        pages: [persistedEntry],
      }),
      pages: [
        {
          legacyId: "old-page",
          pageId: "Pg0001",
          bytes: persistedBytes.byteLength,
          sha256: createHash("sha256").update(persistedBytes).digest("hex"),
        },
      ],
    };
    const validated = await validateDeletedArtifactReplay({
      manifest: replayManifest,
      admission,
      source: { read: async () => new Uint8Array(persistedBytes) },
      protectedPageIds: new Set(),
    });
    let replayPublication: Record<string, unknown> | undefined;
    const replayResult = await applyDeletedArtifactReplay({
      validated,
      maps: {
        pages: { "old-page": "Pg0001" },
        users: {},
        groups: {},
        tokens: {},
      },
      destination: {
        prepareDeleted: async ({ publications }) => {
          assert.equal(publications?.length, 1);
          replayPublication = publications?.[0];
        },
        supportsExactDeletedAccess: () => true,
        importDeletedPage: async () => {
          const replayProof = await assertDeletedMigrationPublication(
            client,
            {
              ...p,
              ...replayPublication,
            } as DeletedMigrationPublicationContext,
            viewer,
          );
          await registerInactiveMigrationViewerBinding(client, viewer, {
            ...p,
            ...replayPublication,
          } as DeletedMigrationPublicationContext);
          await registerInactiveDatasetAttachments({
            client,
            registrations: [reg],
            publication: replayProof,
          });
          return "unchanged";
        },
      },
      verifyProtectedState: async () => {},
      importMetadata: async () => {},
      verifyDeletedState: async (_manifest, pages) => {
        let pagesCount = 0,
          sources = 0;
        for await (const current of pages) {
          pagesCount++;
          sources += current.revisions.length;
        }
        return {
          pages: pagesCount,
          sources,
          comments: 0,
          snapshots: 0,
          assets: 0,
          backendLinks: 0,
          normalizedBytes: 0,
        };
      },
    });
    assert.equal(replayResult.complete, true);
    assert.equal(replayResult.unchanged, 1);
    assert.equal(replayPublication?.legacyId, "old-page");
    assert.equal(replayPublication?.pageId, "Pg0001");
    assert.equal(
      (await client.query("SELECT deleted_at::text FROM files")).rows[0]
        .deleted_at,
      String(Date.parse(deletedAt)),
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int n FROM dataset_attachment_bindings",
        )
      ).rows[0].n,
      1,
    );
    await client.query(
      `INSERT INTO ${env.schema}_migration.stream_rows VALUES($1,$2,1,$3)`,
      ["legacy", part.path, original],
    );
    await assert.rejects(assertDeletedMigrationPublication(client, p, viewer));
    await client.query(
      `DELETE FROM ${env.schema}_migration.stream_rows WHERE ordinal=1`,
    );
    await client.query(
      `UPDATE ${env.schema}_migration.stream_rows SET record=$1`,
      [{ ...original, source: "forged" }],
    );
    await assert.rejects(assertDeletedMigrationPublication(client, p, viewer));
    await client.query(
      `UPDATE ${env.schema}_migration.stream_rows SET record=$1`,
      [original],
    );
    await client.query(
      `UPDATE ${env.schema}_migration.stream_parts SET digest=$1`,
      ["f".repeat(64)],
    );
    await assert.rejects(assertDeletedMigrationPublication(client, p, viewer));
    await client.query(
      `UPDATE ${env.schema}_migration.stream_parts SET digest=$1`,
      [part.sha256],
    );
    assert.deepEqual(
      (
        await client.query(
          `SELECT manifest FROM ${env.schema}_migration.archives`,
        )
      ).rows[0].manifest,
      { artifacts: [{ id: "unrelated" }] },
    );
    assert.equal(await loadDatasetViewer(client, context, 100), null);
    const db = createSqlDatabase({
        pool: env.pool,
        initialize: async () => {},
        statementTimeoutMs: 15000,
      }),
      repo = createDatasetAttachmentRepository({
        database: db,
        now: () => 100,
      }),
      caller = {
        ...context,
        credentialHash: "session",
        backendNamespace: "bridge",
        bindingName: "sales",
      };
    await client.query(
      "INSERT INTO sessions(token_hash,actor,expires) VALUES('session','member',9999999999999)",
    );
    assert.equal(await repo.authority(caller), null);
    await client.query("UPDATE files SET deleted_at=NULL");
    assert.ok(await loadDatasetViewer(client, context, 100));
    assert.ok(await repo.authority(caller));
    await assert.rejects(
      registerInactiveMigrationViewerBinding(client, viewer, p),
    );
    await client.query(
      `UPDATE files SET access='{"visibility":"private","linkRole":"viewer","shares":{},"version":1}'`,
    );
    assert.equal(await loadDatasetViewer(client, context, 100), null);
    assert.equal(await repo.authority(caller), null);
  } finally {
    client.release();
    await env.pool.query(
      `DROP SCHEMA IF EXISTS ${env.schema}_migration CASCADE`,
    );
    await env.cleanup();
  }
});
