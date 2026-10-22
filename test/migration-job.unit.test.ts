import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportLegacyStream } from "../src/migration/stream.ts";
import { runMigrationJob } from "../src/migration/job.ts";
import type { MigrationJobOptions } from "../src/migration/job-contracts.ts";
async function fixture(
  directory: string,
  bad = false,
): Promise<MigrationJobOptions> {
  let table = "";
  let fetched = false;
  const artifacts = ["abc123", "def456", "ghi789"].map((id) => ({
    id,
    format: "markup",
    version: bad ? 0 : 1,
    user_id: "u",
    group_id: null,
    token_id: "",
    source: "<p>Fixture</p>",
    document: null,
    visibility: "private",
    link_role: "viewer",
  }));
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
  return {
    sourceDirectory: join(directory, "source"),
    indexDirectory: join(directory, "index"),
    schema: "isolated_fixture",
    reportPath: join(directory, "report.ndjson"),
    apply: false,
    concurrency: 2,
    origin: "http://localhost:8787",
    legacyOrigins: [],
    editorManageRestricted: true,
    conversionStrategy: "strict",
  };
}
for (const concurrency of [1, 2, 3, 4] as const)
  test(`typed dry-run job bounds conversion concurrency at ${concurrency} without opening a destination`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "migration-job-"));
    try {
      const options = await fixture(directory);
      options.concurrency = concurrency;
      let active = 0,
        peak = 0,
        calls = 0,
        connections = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const summary = await runMigrationJob(options, {
        connectDestination: async () => {
          connections++;
          throw new Error("No destination permitted");
        },
        convert: async () => {
          active++;
          peak = Math.max(peak, active);
          if (++calls === Math.min(concurrency, 3)) release();
          await gate;
          active--;
          return {
            classification: "renderable",
            html: "<p>Fixture</p>",
            issues: [],
            identities: {},
          };
        },
      });
      assert.equal(peak, Math.min(concurrency, 3));
      assert.equal(calls, 3);
      assert.equal(connections, 0);
      assert.equal(summary.inventory.markup?.ready, 3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
test("failed complete preflight never opens an actual destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-job-"));
  try {
    const options = await fixture(directory, true);
    let connections = 0;
    await assert.rejects(
      runMigrationJob(
        { ...options, apply: true, concurrency: 1 },
        {
          connectDestination: async () => {
            connections++;
            throw new Error("Should not connect");
          },
        },
      ),
      /Invalid or duplicate source revision/,
    );
    assert.equal(connections, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("compiler provenance changes abort before destination connects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-provenance-"));
  try {
    const options = await fixture(directory);
    options.apply = true;
    options.concurrency = 1;
    let identities = 0,
      connections = 0;
    await assert.rejects(
      runMigrationJob(options, {
        compilerIdentity: async () => (++identities === 1 ? "before" : "after"),
        convert: () => ({
          classification: "renderable",
          html: "<p>Fixture</p>",
          issues: [],
          identities: {},
        }),
        connectDestination: async () => {
          connections++;
          throw new Error("Must not connect");
        },
      }),
      /provenance changed/,
    );
    assert.equal(connections, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("read-only storage measurement reproduces final normalized UTF8 bytes without opening destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-size-"));
  try {
    const options = await fixture(directory);
    options.measureStorage = true;
    const summary = await runMigrationJob(options, {
      compilerIdentity: async () => "pinned",
      connectDestination: async () => {
        throw Error("Must not connect");
      },
      convert: () => ({
        classification: "renderable",
        html: "<p>Résumé 🌍</p>",
        issues: [],
        identities: {},
      }),
    });
    assert.equal(summary.storageReport, options.reportPath + ".storage.json");
    const report = JSON.parse(await readFile(summary.storageReport!, "utf8"));
    assert.equal(report.destinationWrite, false);
    assert.equal(report.postgresAllocationEstimate, false);
    assert.equal(report.measurement.pages, 3);
    assert.equal(report.measurement.sources, 3);
    assert.ok(
      report.measurement.normalizedSourceBytes >
        3 * Buffer.byteLength("<p>Résumé 🌍</p>"),
    );
    assert.equal(report.measurement.rawArchiveRows, 4);
    assert.equal(report.compilerIdentity, "pinned");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
