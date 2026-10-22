import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
test("typed job bounds conversion concurrency and never opens a dry-run destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-job-"));
  try {
    const options = await fixture(directory);
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
        if (++calls === 2) release();
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
    assert.equal(peak, 2);
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
