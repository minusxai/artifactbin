// @requires migration-database
import { verifyMigrationRuntime } from "../src/migration/page-verification.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  PostgresMigrationDestination,
  buildAccountMaps,
} from "../src/migration/postgres.ts";
import { PostgresStreamArchive } from "../src/migration/stream-postgres.ts";
import { planMigration, applyMigration } from "../src/migration/import.ts";
import type { MigrationManifest } from "../src/migration/contracts.ts";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
test(
  "isolated Postgres import preserves revisions, comments, snapshots, ACL and receipts atomically",
  { skip: !process.env.MIGRATION_TEST_DATABASE_URL },
  async () => {
    const db = new Client({
      connectionString: process.env.MIGRATION_TEST_DATABASE_URL,
    });
    await db.connect();
    const schema = "migration_test_" + process.pid;
    try {
      const manifest: MigrationManifest = {
        schemaVersion: 1,
        sourceNamespace: "fixture",
        exportedAt: "epoch",
        tokenOwners: [{ id: "anonymous", user_id: null }],
        tables: {
          groups: [
            { id: "team", name: "Fixture group" },
            { id: "retired", deleted_at: "2026-01-01" },
          ],
          group_members: [{ group_id: "team", user_id: "u2", role: "viewer" }],
          users: [
            { id: "u1", email: "owner@example.test" },
            { id: "u2", email: "reader@example.test" },
            {
              id: "historical",
              email: null,
              name: "Historical",
              username: "should-not-copy",
            },
          ],
          artifact_versions: [
            {
              artifact_id: "source",
              version: 1,
              format: "markup",
              source: "old",
            },
          ],
          annotations: [
            {
              id: "comment",
              artifact_id: "source",
              body: "Hello",
              author_user_id: "u2",
              anchor_version: 1,
              anchor_key: "node",
              created_at: "2026-01-01T00:00:00Z",
              status: "open",
              view_state: { scroll: 1 },
            },
            {
              id: "unavailable",
              artifact_id: "source",
              body: "Retained body",
              quote: "Retained quote",
              author_token_id: "anonymous",
              anchor_version: 99,
              anchor_key: "node",
              view_state: { scroll: 4 },
              created_at: "2026-01-01T00:00:00Z",
              status: "open",
            },
            {
              id: "deleted",
              artifact_id: "source",
              body: "Removed",
              deleted_at: "2026-01-02",
            },
          ],
        },
        artifacts: [
          {
            id: "source",
            version: 2,
            format: "markup",
            source: "new",
            document: null,
            user_id: "u1",
            group_id: null,
            token_id: "t",
            visibility: "private",
            link_role: "viewer",
            title: "Fixture",
          },
        ],
      };
      manifest.tables.annotations!.push({
        id: "reply",
        artifact_id: "source",
        root_id: "comment",
        body: "Reply",
        author_user_id: "u2",
        anchor_version: null,
        created_at: "2026-01-02T00:00:00Z",
      });
      const plan = await planMigration(manifest, {
        maps: buildAccountMaps(manifest),
        coreUrl: "/af/v1/core.js",
        convert: ({ source }) => ({
          classification: "renderable",
          html: `<html><p data-af-id="${source === "old" ? "historical-node" : "head-node"}">${source}</p></html>`,
          identities: {
            node: source === "old" ? "historical-node" : "head-node",
          },
          issues: [],
        }),
      });
      const archive = new PostgresStreamArchive(db, schema, true);
      await archive.initialize();
      const part = {
        table: "artifact_edits",
        path: "edits-0.ndjson",
        rows: 2,
        bytes: 40,
        sha256: "fixture-digest",
      };
      async function* records() {
        yield { artifact_id: "source", removed: "old" };
        yield { artifact_id: "source", inserted: "new" };
      }
      assert.equal(
        await archive.archivePart("fixture", part, records()),
        "created",
      );
      assert.equal(
        await archive.archivePart("fixture", part, records()),
        "unchanged",
      );
      await assert.rejects(
        archive.archivePart(
          "fixture",
          { ...part, sha256: "changed" },
          records(),
        ),
        /receipt conflict/,
      );
      async function* broken() {
        yield { artifact_id: "source" };
        throw new Error("interrupted");
      }
      await assert.rejects(
        archive.archivePart(
          "fixture",
          { ...part, path: "interrupted.ndjson" },
          broken(),
        ),
        /interrupted/,
      );
      assert.equal(
        (
          await db.query(
            `SELECT count(*)::int AS n FROM "${schema}_migration".stream_rows WHERE path='interrupted.ndjson'`,
          )
        ).rows[0].n,
        0,
      );
      const destination = new PostgresMigrationDestination(db, {
        schema,
        origin: "http://localhost:8787",
        isolated: true,
        editorManageRestricted: true,
      });
      plan.pages[0]!.commentAssets = [
        {
          objectKey: "comment-images/image/original.webp",
          kind: "comment-image",
          sha256: "a".repeat(64),
          storageKey: "a".repeat(64),
          byteLength: 20,
          width: 10,
          height: 5,
          contentType: "image/webp",
          legacyArtifactId: plan.pages[0]!.legacyId,
          commentId: String(plan.pages[0]!.comments[0]!.id),
          attachmentId: "image",
          variant: "original",
          name: "Attached image",
        },
      ];
      await destination.prepare({ manifest, maps: plan.maps });
      assert.equal(
        (await applyMigration(plan, destination, { dryRun: false })).created,
        1,
      );
      assert.equal(
        (await applyMigration(plan, destination, { dryRun: false })).unchanged,
        1,
      );
      async function* expectedPages() {
        yield plan.pages[0]!;
      }
      const verify = () =>
        verifyMigrationRuntime(db, schema, {
          pages: expectedPages(),
          maps: plan.maps,
          origin: "http://localhost:8787",
        });
      assert.equal((await verify()).comments, 3);
      await db.query(
        `UPDATE "${schema}".comment_attachment_assets SET width=11`,
      );
      await assert.rejects(verify(), /comment attachment descriptors/);
      await db.query(
        `UPDATE "${schema}".comment_attachment_assets SET width=10`,
      );
      await verify();
      await db.query(
        `INSERT INTO "${schema}".dataset_viewer_bindings VALUES('Back12','v1',$1,1,'unplanned')`,
        [plan.pages[0]!.pageId],
      );
      await assert.rejects(verify(), /viewer backend registry/);
      await db.query(`DELETE FROM "${schema}".dataset_viewer_bindings`);
      await verify();
      const baseline = (
        await db.query(`SELECT * FROM "${schema}".files WHERE id=$1`, [
          plan.pages[0]!.pageId,
        ])
      ).rows[0];
      for (const [column, value] of Object.entries({
        deleted_at: 123456789,
        seed: { tampered: true },
        sequence: 999,
        source_digest: "tampered",
        next_node_id: 999999,
        generation: 2,
        share: "public",
        trash_path: "/bad",
        trash_batch: "bad",
      })) {
        await db.query(
          `UPDATE "${schema}".files SET ${column}=$2 WHERE id=$1`,
          [
            plan.pages[0]!.pageId,
            column === "seed" ? JSON.stringify(value) : value,
          ],
        );
        await assert.rejects(verify(), /page owner\/head\/ACL/);
        await db.query(
          `UPDATE "${schema}".files SET ${column}=$2 WHERE id=$1`,
          [
            plan.pages[0]!.pageId,
            column === "seed"
              ? JSON.stringify(baseline[column])
              : baseline[column],
          ],
        );
      }
      await db.query(
        `INSERT INTO "${schema}".af_backend_pages VALUES ($1,999)`,
        [plan.pages[0]!.pageId],
      );
      await assert.rejects(verify(), /current backend page pointer/);
      await db.query(
        `DELETE FROM "${schema}".af_backend_pages WHERE page_id=$1`,
        [plan.pages[0]!.pageId],
      );

      await db.query(
        `INSERT INTO "${schema}".dataset_member_bindings VALUES ('fakeid','fakeversion',$1,1,'fixture')`,
        [plan.pages[0]!.pageId],
      );
      await assert.rejects(verify(), /member backend registry/);
      await db.query(
        `DELETE FROM "${schema}".dataset_member_bindings WHERE page_id=$1`,
        [plan.pages[0]!.pageId],
      );
      await db.query(
        `UPDATE "${schema}".files SET access=jsonb_set(access,'{visibility}','"public"') WHERE id=$1`,
        [plan.pages[0]!.pageId],
      );
      await assert.rejects(verify(), /page owner\/head\/ACL/);
      await db.query(
        `UPDATE "${schema}".files SET access=jsonb_set(access,'{visibility}','"private"') WHERE id=$1`,
        [plan.pages[0]!.pageId],
      );
      await db.query(
        `UPDATE "${schema}".comments SET body='tampered' WHERE id='comment'`,
      );
      await assert.rejects(verify(), /comment body/);
      await db.query(
        `UPDATE "${schema}".comments SET body='Hello' WHERE id='comment'`,
      );
      assert.equal((await verify()).sources, 2);
      await db.query(
        `UPDATE "${schema}".comments SET changed=999 WHERE id='comment'`,
      );
      await assert.rejects(verify(), /comment body/);
      await db.query(
        `UPDATE "${schema}".comments SET changed=NULL WHERE id='comment'`,
      );
      await db.query(
        `INSERT INTO "${schema}".retired_file_ids VALUES ($1,123)`,
        [plan.pages[0]!.pageId],
      );
      await assert.rejects(verify(), /must not be retired/);
      await db.query(`DELETE FROM "${schema}".retired_file_ids WHERE id=$1`, [
        plan.pages[0]!.pageId,
      ]);
      await db.query(
        `DELETE FROM "${schema}".folders WHERE owner=$1 AND path='/imported'`,
        [plan.pages[0]!.owner!.id],
      );
      await assert.rejects(verify(), /page parent folders/);
      await db.query(
        `INSERT INTO "${schema}".folders VALUES ($1,'/imported')`,
        [plan.pages[0]!.owner!.id],
      );

      const q = (sql: string) => db.query(`SELECT ${sql}`);
      const anchored = (
        await db.query(
          `SELECT id,source_revision,node_id,parent_id FROM "${schema}".comments WHERE id IN ('comment','reply') ORDER BY id`,
        )
      ).rows;
      assert.deepEqual(anchored, [
        {
          id: "comment",
          source_revision: "1",
          node_id: "historical-node",
          parent_id: null,
        },
        {
          id: "reply",
          source_revision: "1",
          node_id: "historical-node",
          parent_id: "comment",
        },
      ]);
      const unavailable = (
        await db.query(
          `SELECT source_revision,node_id,app_state_id,context_status,body,quote,published_by FROM "${schema}".comments WHERE id='unavailable'`,
        )
      ).rows[0];
      assert.deepEqual(unavailable, {
        source_revision: null,
        node_id: null,
        app_state_id: null,
        context_status: {
          status: "unavailable",
          originalRevision: "99",
          reason: "not-retained",
        },
        body: "Retained body",
        quote: "Retained quote",
        published_by: plan.maps.tokens.anonymous,
      });
      const tokenAccount = (
        await db.query(
          `SELECT salt,password,handle FROM "${schema}".accounts WHERE actor=$1`,
          [plan.maps.tokens.anonymous],
        )
      ).rows[0];
      assert.deepEqual(tokenAccount, {
        salt: null,
        password: null,
        handle: null,
      });
      const opaque = plan.maps.users.historical!;
      const historical = (
        await db.query(
          `SELECT name,salt,password,handle FROM "${schema}".accounts WHERE actor=$1`,
          [opaque],
        )
      ).rows[0];
      assert.deepEqual(historical, {
        name: "Historical",
        salt: null,
        password: null,
        handle: null,
      });
      assert.equal(
        (await q(`count(*)::int AS n FROM "${schema}".sessions`)).rows[0].n,
        0,
      );
      assert.equal(
        (await q(`count(*)::int AS n FROM "${schema}".sources`)).rows[0].n,
        2,
      );
      assert.equal(
        (await q(`count(*)::int AS n FROM "${schema}".comments`)).rows[0].n,
        3,
      );
      assert.equal(
        (await q(`count(*)::int AS n FROM "${schema}".snapshots`)).rows[0].n,
        0,
      );
      assert.equal(
        (await q(`access->>'visibility' AS v FROM "${schema}".files`)).rows[0]
          .v,
        "private",
      );
      assert.equal(
        (
          await q(
            `manifest->'tables'->'annotations'->2->>'body' AS v FROM "${schema}_migration".archives`,
          )
        ).rows[0].v,
        "Removed",
      );
      await assert.rejects(
        destination.importPage("fixture:source", "changed", plan.pages[0]!),
        /receipt conflicts/,
      );
      const groupActor = plan.maps.groups.team!;
      assert.match(groupActor, /^group:/);
      assert.deepEqual(
        (
          await db.query(
            `SELECT a.principal_kind,a.salt,a.password,a.handle,g.active FROM "${schema}".accounts a JOIN "${schema}".groups g ON g.owner=a.actor WHERE a.actor=$1`,
            [groupActor],
          )
        ).rows[0],
        {
          principal_kind: "group",
          salt: null,
          password: null,
          handle: null,
          active: true,
        },
      );
      assert.equal(
        (
          await db.query(
            `SELECT role FROM "${schema}".group_memberships WHERE owner=$1 AND actor=$2`,
            [groupActor, plan.maps.users.u2],
          )
        ).rows[0].role,
        "viewer",
      );
      const groupPage = structuredClone(plan.pages[0]!);
      groupPage.pageId = "grp001";
      groupPage.legacyId = "group-source";
      groupPage.owner = { kind: "group", id: groupActor };
      groupPage.original.group_id = "team";
      groupPage.original.user_id = null;
      groupPage.assets = [
        {
          revision: "1",
          variant: "original",
          sha256: "a".repeat(64),
          contentType: "image/png",
          filename: "fixture.png",
          bytes: 10,
        },
      ];
      assert.equal(destination.supportsExactAccess(groupPage), true);
      assert.equal(
        await destination.importPage(
          "fixture:group-source",
          "group-checksum",
          groupPage,
        ),
        "created",
      );
      await destination.prepare({ manifest, maps: plan.maps });
      assert.deepEqual(
        (
          await db.query(
            `SELECT revision,variant,sha256,storage_key,byte_length::int AS bytes FROM "${schema}".page_assets WHERE page_id='grp001'`,
          )
        ).rows[0],
        {
          revision: "1",
          variant: "original",
          sha256: "a".repeat(64),
          storage_key: "a".repeat(64),
          bytes: 10,
        },
      );
      await db.query(
        `DELETE FROM "${schema}".group_memberships WHERE owner=$1`,
        [groupActor],
      );
      await assert.rejects(
        destination.prepare({ manifest, maps: plan.maps }),
        /membership conflicts/,
      );
      assert.equal(
        (
          await db.query(
            `SELECT count(*)::int AS n FROM "${schema}".group_memberships WHERE owner=$1`,
            [groupActor],
          )
        ).rows[0].n,
        0,
      );
      // A missing author fails after page/source insertion and rolls every runtime row back.
      const bad = structuredClone(plan.pages[0]!);
      bad.pageId = "bad123";
      bad.legacyId = "bad";
      bad.comments[0]!.author_user_id = "unknown";
      bad.assets = groupPage.assets;
      await assert.rejects(
        destination.importPage("fixture:bad", "bad", bad),
        /Unmapped comment author/,
      );
      assert.equal(
        (await q(`count(*)::int AS n FROM "${schema}".files WHERE id='bad123'`))
          .rows[0].n,
        0,
      );
      assert.equal(
        (
          await q(
            `count(*)::int AS n FROM "${schema}".page_assets WHERE page_id='bad123'`,
          )
        ).rows[0].n,
        0,
      );
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.query(`DROP SCHEMA IF EXISTS "${schema}_migration" CASCADE`);
      await db.end();
    }
  },
);
