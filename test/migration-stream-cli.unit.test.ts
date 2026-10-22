import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { exportLegacyStream } from "../src/migration/stream.ts";

test("dry-run CLI inventories a bad artifact as an error and continues without a database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "migration-cli-"));
  try {
    const artifacts = ["abc123", "bad123", "def456"].map((id) => ({
      id,
      format: "markup",
      version: id === "bad123" ? 0 : 1,
      user_id: "u",
      group_id: null,
      token_id: "t",
      source: "<p>Fixture</p>",
      document: null,
      visibility: "private",
      link_role: "viewer",
    }));
    artifacts.push({
      ...artifacts[0]!,
      id: "dep123",
      source:
        '<img src="/af/v1/ids/bad123/assets/1/original/' +
        "a".repeat(64) +
        '" />',
    });
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
        "isolated_fixture",
        report,
        "--conversion-strategy=strict",
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH } },
    );
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(
      await readFile(report + ".summary.json", "utf8"),
    );
    assert.equal(summary.dryRun, true);
    assert.equal(summary.conversionStrategy, "strict");
    assert.deepEqual(summary.result, {
      created: 0,
      unchanged: 0,
      blocked: 2,
      errors: 1,
    });
    assert.deepEqual(summary.inventory.markup, {
      total: 4,
      ready: 2,
      blocked: 2,
    });
    const readiness = JSON.parse(
      await readFile(report + ".readiness.json", "utf8"),
    );
    assert.equal(summary.dependencyBlocked, 1);
    assert.equal(readiness.readiness.ready.includes("dep123"), false);
    assert.ok(readiness.readiness.blocked.dep123.length);
    const records = (await readFile(report, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(records.length, 4);
    assert.equal(records.filter((r) => r.disposition === "error").length, 1);
    assert.equal(records.filter((r) => r.disposition === "ready").length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
