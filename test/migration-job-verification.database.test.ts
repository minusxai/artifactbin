// @requires migration-database
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { exportLegacyStream } from "../src/migration/stream.ts";
import { prepareMigrationJobSource } from "../src/migration/job-source.ts";
import {
  createMigrationJobPlanner,
  planMigrationJob,
} from "../src/migration/job-planning.ts";
import { PostgresMigrationDestination } from "../src/migration/postgres.ts";
import { applyMigrationJob } from "../src/migration/job-apply.ts";
import { verifyMigrationJob } from "../src/migration/job-verification.ts";
import type {
  MigrationJobOptions,
  MigrationPagePlanner,
} from "../src/migration/job-contracts.ts";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

test(
  "job verification plans each ready source once and writes success only after every check passes",
  { skip: !process.env.MIGRATION_TEST_DATABASE_URL },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "migration-verification-"));
    const schema = `migration_verify_${process.pid}`;
    const db = new Client({
      connectionString: process.env.MIGRATION_TEST_DATABASE_URL,
    });
    await db.connect();
    try {
      let table = "";
      let fetched = false;
      const artifacts = [
        {
          id: "abc123",
          format: "markup",
          version: 1,
          user_id: "u",
          group_id: null,
          token_id: "",
          source: "<p>First</p>",
          document: null,
          visibility: "private",
          link_role: "viewer",
        },
        {
          id: "def456",
          format: "markup",
          version: 1,
          user_id: "u",
          group_id: null,
          token_id: "",
          source: "<p>Second</p>",
          document: null,
          visibility: "private",
          link_role: "viewer",
        },
      ];
      const sourceDirectory = join(directory, "source");
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
          sourceNamespace: "verification-fixture",
          directory: sourceDirectory,
          now: () => new Date(0),
        },
        ["users", "artifacts"],
      );

      const options: MigrationJobOptions = {
        sourceDirectory,
        indexDirectory: join(directory, "index"),
        schema,
        reportPath: join(directory, "plan.ndjson"),
        apply: false,
        concurrency: 1,
        origin: "http://localhost:8787",
        legacyOrigins: [],
        editorManageRestricted: true,
        conversionStrategy: "strict",
      };
      const source = await prepareMigrationJobSource(options);
      const planner = createMigrationJobPlanner(source, options, ({ source }) => ({
        classification: "renderable",
        html: `<html><body>${source}</body></html>`,
        issues: [],
        identities: {},
      }));
      const preflight = new PostgresMigrationDestination(
        db,
        {
          schema,
          sourceNamespace: source.manifest.sourceNamespace,
          origin: options.origin,
          isolated: true,
          editorManageRestricted: options.editorManageRestricted,
        },
        source.maps,
      );
      const planned = await planMigrationJob(source, options, planner, preflight);
      const destination = new PostgresMigrationDestination(
        db,
        {
          schema,
          sourceNamespace: source.manifest.sourceNamespace,
          origin: options.origin,
          isolated: true,
          editorManageRestricted: options.editorManageRestricted,
        },
        source.maps,
      );
      await applyMigrationJob(source, options, planned, planner, destination, db);

      const callsById = new Map<string, number>();
      const countPlannerCalls: MigrationPagePlanner = async (artifact) => {
        callsById.set(artifact.artifacts[0]!.id, (callsById.get(artifact.artifacts[0]!.id) ?? 0) + 1);
        return planner(artifact);
      };
      const successfulReport = join(directory, "successful.verification");
      const successful = await verifyMigrationJob(
        source,
        { ...options, reportPath: successfulReport },
        planned,
        countPlannerCalls,
        db,
      );
      assert.deepEqual(
        [...callsById.entries()].sort(([a], [b]) => a.localeCompare(b)),
        [
          ["abc123", 1],
          ["def456", 1],
        ],
      );
      assert.equal(successful.complete, true);
      assert.equal(successful.runtime.pages, 2);
      assert.equal(
        JSON.parse(await readFile(successfulReport + ".verification.json", "utf8"))
          .complete,
        true,
      );

      const interruptedReport = join(directory, "interrupted.verification");
      let interruptedCalls = 0;
      const interruptedPlanner: MigrationPagePlanner = async (artifact) => {
        if (++interruptedCalls === 2) throw Error("second source unavailable");
        return planner(artifact);
      };
      await assert.rejects(
        verifyMigrationJob(
          source,
          { ...options, reportPath: interruptedReport },
          planned,
          interruptedPlanner,
          db,
        ),
        /second source unavailable/,
      );
      assert.equal(interruptedCalls, 2);
      await assert.rejects(
        readFile(interruptedReport + ".verification.json"),
        { code: "ENOENT" },
      );
      assert.deepEqual((await db.query("SELECT 1 AS connected")).rows, [
        { connected: 1 },
      ]);

      const sourceRow = (
        await db.query(
          `SELECT file_id,revision,content FROM "${schema}".sources ORDER BY file_id LIMIT 1`,
        )
      ).rows[0]!;
      await db.query(
        `UPDATE "${schema}".sources SET content=$3 WHERE file_id=$1 AND revision=$2`,
        [sourceRow.file_id, sourceRow.revision, `${sourceRow.content} corrupt`],
      );
      const corruptReport = join(directory, "corrupt.verification");
      await assert.rejects(
        verifyMigrationJob(
          source,
          { ...options, reportPath: corruptReport },
          planned,
          planner,
          db,
        ),
        /saved HTML revisions and identities/,
      );
      await assert.rejects(
        readFile(corruptReport + ".verification.json"),
        { code: "ENOENT" },
      );
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.query(`DROP SCHEMA IF EXISTS "${schema}_migration" CASCADE`);
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
