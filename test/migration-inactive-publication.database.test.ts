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
    await client.query("INSERT INTO sources(file_id,revision,content) VALUES('Pg0001','1','converted')");
    await client.query(
      "UPDATE files SET deleted_at=$1",
      [Date.parse(deletedAt)],
    );
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
    for (let i = 0; i < 2; i++) {
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
    }
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
    assert.equal(await loadDatasetViewer(client, context, 100), null);
    const db = createSqlDatabase({
        pool: env.pool,
        initialize: async () => {},statementTimeoutMs:15000,
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
