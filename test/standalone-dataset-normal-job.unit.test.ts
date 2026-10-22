import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { exportLegacyStream } from "../src/migration/stream.ts";
import { prepareMigrationJobSource } from "../src/migration/job-source.ts";
import {
  migrationOwnershipSourceDigest,
  migrationOwnershipScopeDigest,
} from "../src/migration/ownership-override.ts";
import { runMigrationJob } from "../src/migration/job.ts";
import {
  standaloneDatasetFixture,
  standaloneDatasetHost,
} from "./support/standalone-dataset.ts";

test("normal destinationless job admits only the exact standalone head while reserving deleted source IDs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "standalone-normal-"));
  try {
    const { artifact, source, options } = standaloneDatasetFixture();
    const inheritedPage = {
      ...artifact,
      id: "other0",
      format: "markup",
      source: "<p>preserved owner</p>",
      user_id: null,
    };
    const tables = {
      users: source.base.tables.users!,
      artifacts: [
        artifact,
        inheritedPage,
        {
          ...artifact,
          id: "gone01",
          format: "markup",
          source: "<p>old</p>",
          deleted_at: "2026-01-01T00:00:00Z",
        },
      ],
    };
    let selected: keyof typeof tables = "users",
      fetched = false;
    const base = await exportLegacyStream(
      {
        query: async (sql) => {
          if (sql.startsWith("DECLARE")) {
            selected = sql.includes('"users"') ? "users" : "artifacts";
            fetched = false;
          }
          if (sql.startsWith("FETCH")) {
            if (fetched) return { rows: [] };
            fetched = true;
            return { rows: tables[selected] };
          }
          return { rows: [] };
        },
      },
      {
        schema: "legacy",
        sourceNamespace: "fixture",
        directory: join(dir, "source"),
        now: () => new Date(0),
      },
      ["users", "artifacts"],
    );
    await exportLegacyStream(
      { query: async () => ({ rows: [] }) },
      {
        schema: "legacy",
        sourceNamespace: "fixture",
        directory: join(dir, "relations"),
        now: () => new Date(0),
      },
      [],
    );
    const relationPath = join(dir, "relations", "manifest.json");
    await writeFile(
      relationPath,
      JSON.stringify({
        ...JSON.parse(await readFile(relationPath, "utf8")),
        supplemental: true,
        consistency: "independent-repeatable-read-read-only",
        supplementsExportedAt: base.exportedAt,
      }),
    );
    const object = join(dir, "rows.json");
    await writeFile(object, "[]");
    const sha = createHash("sha256").update("[]").digest("hex");
    const receipts = join(dir, "receipts.json");
    await writeFile(
      receipts,
      JSON.stringify([
        {
          objectKey: "dataset/" + sha.slice(0, 32),
          status: "copied",
          sha256: sha,
          bytes: 2,
          path: object,
        },
      ]),
    );
    Object.assign(options, {
      sourceDirectory: join(dir, "source"),
      indexDirectory: join(dir, "index"),
      reportPath: join(dir, "report.ndjson"),
      datasets: {
        receiptsPath: receipts,
        relationDirectory: join(dir, "relations"),
      },
    });
    const policy = {
      schemaVersion: 1 as const,
      sourceNamespace: "fixture",
      targetEmail: "owner@example.test",
      entries: [
        {
          legacyId: inheritedPage.id,
          sourceSha256: migrationOwnershipSourceDigest(inheritedPage),
        },
      ],
    };
    options.ownershipOverride = {
      ...policy,
      scopeSha256: migrationOwnershipScopeDigest(policy),
    };
    const prepared = await prepareMigrationJobSource(options);
    options.standaloneDatasetPages!.reservedFileIds = Object.values(
      prepared.maps.pages,
    );
    const report = await runMigrationJob(options, {
      backendHost: standaloneDatasetHost,
      compilerIdentity: async () => "fixture",
      convert: async () => {
        throw Error("no other source may be converted");
      },
      connectDestination: async () => {
        throw Error("destination must stay closed");
      },
    });
    assert.equal(report.complete, true);
    assert.equal(report.inventory.dataset?.ready, 1);
    assert.equal(report.result.created, 0);
    assert.equal(report.result.errors, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
