import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("pg");
import {
  archiveMigrationSources,
  readMigrationArchiveSources,
} from "../src/migration/archive-sources.ts";
import { verifyMigrationArchives } from "../src/migration/archive-verification.ts";
test(
  "base and supplemental raw archives replay atomically and independent verification detects row corruption despite valid receipts",
  { skip: !process.env.MIGRATION_TEST_DATABASE_URL },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "archive-verify-"));
    const db = new Client({
      connectionString: process.env.MIGRATION_TEST_DATABASE_URL,
    });
    await db.connect();
    const schema = "archive_verify_" + process.pid;
    try {
      for (const [kind, table] of [
        ["base", "artifacts"],
        ["relations", "relations"],
      ] as const) {
        const directory = join(root, kind);
        await mkdir(directory);
        const text =
          JSON.stringify({ id: "fixture", nested: { value: 1 } }) + "\n";
        await writeFile(join(directory, "part.ndjson"), text);
        const manifest = {
          schemaVersion: 2,
          sourceNamespace: "fixture",
          schema: "legacy",
          exportedAt: kind,
          parts: [
            {
              table,
              path: "part.ndjson",
              rows: 1,
              bytes: Buffer.byteLength(text),
              sha256: createHash("sha256").update(text).digest("hex"),
            },
          ],
          ...(kind === "relations"
            ? {
                supplemental: true,
                consistency: "independent-repeatable-read-read-only",
                supplementsExportedAt: "base",
              }
            : {}),
        };
        await writeFile(
          join(directory, "manifest.json"),
          JSON.stringify(manifest),
        );
      }
      const sources = await readMigrationArchiveSources({
        baseDirectory: join(root, "base"),
        relationDirectory: join(root, "relations"),
      });
      await archiveMigrationSources(db, schema, sources);
      await archiveMigrationSources(db, schema, sources);
      assert.deepEqual(await verifyMigrationArchives(db, schema, sources), {
        manifests: 2,
        parts: 2,
        rows: 2,
        bytes: sources.reduce((n, s) => n + s.manifest.parts[0]!.bytes, 0),
      });
      await db.query(
        `UPDATE "${schema}_migration".stream_rows SET record='{"id":"corrupt"}' WHERE namespace='fixture:supplemental-relations'`,
      );
      await assert.rejects(
        verifyMigrationArchives(db, schema, sources),
        /raw row mismatch/i,
      );
      await db.query(
        `UPDATE "${schema}_migration".stream_rows SET record=$1::jsonb WHERE namespace='fixture:supplemental-relations'`,
        [JSON.stringify({ id: "fixture", nested: { value: 1 } })],
      );
      await db.query(
        `DELETE FROM "${schema}_migration".stream_rows WHERE namespace='fixture:supplemental-relations'`,
      );
      await assert.rejects(
        verifyMigrationArchives(db, schema, sources),
        /raw namespace row count/,
      );
      await db.query(
        `INSERT INTO "${schema}_migration".stream_rows VALUES ('fixture:supplemental-relations','part.ndjson',0,$1::jsonb)`,
        [JSON.stringify({ id: "fixture", nested: { value: 1 } })],
      );
      await db.query(
        `UPDATE "${schema}_migration".stream_manifests SET manifest='{}' WHERE namespace='fixture:supplemental-relations'`,
      );
      await assert.rejects(
        verifyMigrationArchives(db, schema, sources),
        /manifest provenance/,
      );
      await db.query(
        `UPDATE "${schema}_migration".stream_manifests SET manifest=$1::jsonb WHERE namespace='fixture:supplemental-relations'`,
        [JSON.stringify(sources[1]!.originalManifest)],
      );
      await db.query(
        `UPDATE "${schema}_migration".stream_rows SET record='{}' WHERE namespace='fixture:supplemental-relations'`,
      );
      // Receipts still match, so restart must not be mistaken for independent verification.
      await archiveMigrationSources(db, schema, sources);
      await assert.rejects(
        verifyMigrationArchives(db, schema, sources),
        /raw row mismatch/i,
      );
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}_migration" CASCADE`);
      await db.end();
      await rm(root, { recursive: true, force: true });
    }
  },
);
