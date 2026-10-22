// @requires migration-database
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { exportLegacyStream } from "../src/migration/stream.ts";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
test(
  "stream apply finishes dependency preflight before importing only complete pages and verified descriptors",
  { skip: !process.env.MIGRATION_TEST_DATABASE_URL },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "migration-apply-"));
    const schema = "migration_cli_" + process.pid;
    const db = new Client({
      connectionString: process.env.MIGRATION_TEST_DATABASE_URL,
    });
    await db.connect();
    try {
      const bytes = Buffer.from("fixture bytes");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const assetPath = join(directory, "object");
      await writeFile(assetPath, bytes);
      await writeFile(
        join(directory, "plan.json"),
        JSON.stringify({
          objects: [
            {
              objectKey: "object",
              contentType: "image/png",
              expectedBytes: bytes.length,
              references: [
                { artifactId: "def456", version: 1, variant: "original" },
              ],
            },
          ],
        }),
      );
      await writeFile(
        join(directory, "receipts.json"),
        JSON.stringify([
          {
            objectKey: "object",
            status: "copied",
            path: assetPath,
            bytes: bytes.length,
            sha256,
          },
        ]),
      );
      const row = {
        format: "markup",
        version: 1,
        user_id: "u",
        group_id: null,
        token_id: "",
        source: "<p>Fixture</p>",
        document: null,
        visibility: "private",
        link_role: "viewer",
      };
      const artifacts = [
        {
          ...row,
          id: "abc123",
          source: `<img src="/af/v1/ids/def456/assets/1/original/${sha256}" />`,
        },
        { ...row, id: "def456", format: "image", source: null },
        {
          ...row,
          id: "dep123",
          source: `<img src="/af/v1/ids/absent/assets/1/original/${sha256}" />`,
        },
      ];
      let table = "";
      let fetched = false;
      await exportLegacyStream(
        {
          query: async (sql) => {
            if (sql.startsWith("DECLARE")) {
              table = sql.includes('"users"') ? "users" : "artifacts";
              fetched = false;
            }
            if (sql.startsWith("FETCH")) {
              if (fetched) return { rows: [] };
              fetched = true;
              return {
                rows:
                  table === "users"
                    ? [{ id: "u", email: "owner@example.test" }]
                    : artifacts,
              };
            }
            return { rows: [] };
          },
        },
        {
          schema: "legacy",
          sourceNamespace: "fixture",
          directory: join(directory, "source"),
          now: () => new Date(0),
        },
        ["users", "artifacts"],
      );
      const report = join(directory, "report.ndjson");
      const result = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          fileURLToPath(
            new URL("../scripts/migration/import-stream.ts", import.meta.url),
          ),
          join(directory, "source"),
          join(directory, "index"),
          schema,
          report,
          "--apply-isolated",
          "--editor-manage-restricted",
        ],
        {
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            MIGRATION_DESTINATION_DATABASE_URL:
              process.env.MIGRATION_TEST_DATABASE_URL,
            MIGRATION_PUBLIC_ORIGIN: "http://localhost:8787",
            MIGRATION_MEDIA_PLAN: join(directory, "plan.json"),
            MIGRATION_MEDIA_RECEIPTS: join(directory, "receipts.json"),
            MIGRATION_MEDIA_STAGING_DIRECTORY: join(directory, "media"),
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const summary = JSON.parse(
        await readFile(report + ".summary.json", "utf8"),
      );
      assert.deepEqual(summary.result, {
        created: 2,
        unchanged: 0,
        blocked: 1,
        errors: 0,
      });
      assert.equal(summary.dependencyBlocked, 1);
      assert.equal(
        (await db.query(`SELECT count(*)::int AS n FROM "${schema}".files`))
          .rows[0].n,
        2,
      );
      assert.equal(
        (
          await db.query(
            `SELECT count(*)::int AS n FROM "${schema}".page_assets`,
          )
        ).rows[0].n,
        1,
      );
      assert.deepEqual(await readFile(join(directory, "media", sha256)), bytes);
      const verification = JSON.parse(
        await readFile(report + ".verification.json", "utf8"),
      );
      assert.equal(verification.raw.rows, 4);
      assert.equal(verification.runtime.pages, 2);
      const verify = (name: string, flag = "--verify-isolated") =>
        spawnSync(
          process.execPath,
          [
            "--experimental-strip-types",
            fileURLToPath(
              new URL("../scripts/migration/import-stream.ts", import.meta.url),
            ),
            join(directory, "source"),
            join(directory, "index"),
            schema,
            join(directory, name),
            flag,
            "--editor-manage-restricted",
          ],
          {
            encoding: "utf8",
            env: {
              PATH: process.env.PATH,
              MIGRATION_DESTINATION_DATABASE_URL:
                process.env.MIGRATION_TEST_DATABASE_URL,
              MIGRATION_PUBLIC_ORIGIN: "http://localhost:8787",
              MIGRATION_MEDIA_PLAN: join(directory, "plan.json"),
              MIGRATION_MEDIA_RECEIPTS: join(directory, "receipts.json"),
              MIGRATION_MEDIA_STAGING_DIRECTORY: join(directory, "media"),
            },
          },
        );
      const restarted = verify("restart.ndjson", "--apply-isolated");
      assert.equal(restarted.status, 0, restarted.stderr);
      const resumed = JSON.parse(
        await readFile(join(directory, "restart.ndjson.summary.json"), "utf8"),
      );
      assert.equal(resumed.result.created, 0);
      assert.equal(resumed.result.unchanged, 2);
      const verified = verify("independent.ndjson");
      assert.equal(verified.status, 0, verified.stderr);
      await db.query(
        `UPDATE "${schema}_migration".stream_rows SET record='{}' WHERE ordinal=0`,
      );
      const corrupted = verify("corrupted.ndjson");
      assert.notEqual(corrupted.status, 0);
      assert.match(corrupted.stderr, /raw row mismatch/);
      assert.equal(
        (await db.query(`SELECT count(*)::int AS n FROM "${schema}".files`))
          .rows[0].n,
        2,
      );
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.query(`DROP SCHEMA IF EXISTS "${schema}_migration" CASCADE`);
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
