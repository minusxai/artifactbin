import test from "node:test";
import assert from "node:assert/strict";
import { prepareMigrationJobDatasets } from "../src/migration/job-datasets.ts";
import { readBackendModule } from "../src/backend/af-module.ts";
import { sealDeployment } from "../src/backend/deployment.ts";
import { generatedDatasetBackendSource } from "../src/migration/datasets/import-metadata.ts";
import { createMigrationJobPlanner } from "../src/migration/job-planning.ts";
import { migrationPageQueryRegistrations } from "../src/migration/query-registrations.ts";
import type {
  MigrationJobSource,
  MigrationJobOptions,
} from "../src/migration/job-contracts.ts";
import type {
  MigrationManifest,
  LegacyArtifact,
} from "../src/migration/contracts.ts";
for (const native of [false, true])
  test(`${native ? "a native program" : "an import-free saved handler"} gets a linked backend and exact page authority without dataset or membership bindings`, async () => {
    const base: MigrationManifest = {
      schemaVersion: 1,
      sourceNamespace: "fixture",
      exportedAt: "epoch",
      tables: { users: [{ id: "owner", kind: "user" }] },
      artifacts: [],
      tokenOwners: [],
    };
    const page: LegacyArtifact = {
      id: "abc123",
      version: 2,
      format: native ? "program" : "markup",
      source: native
        ? JSON.stringify({
            version: 1,
            command: [
              "node",
              "-e",
              "console.log(process.env.ARTIFACTBIN_INPUT)",
            ],
            compute: { vcpu: 1, memoryMiB: 2048, ttlSeconds: 60 },
          })
        : '<script type="server">{`export function save() { return 1; }`}</script><p>Program</p>',
      document: null,
      user_id: "owner",
      group_id: null,
      token_id: null,
      visibility: "private",
      link_role: "viewer",
      edit_id: "saved-edit",
    };
    const source: MigrationJobSource = {
      manifest: {
        schemaVersion: 2,
        sourceNamespace: "fixture",
        schema: "legacy",
        exportedAt: "epoch",
        parts: [],
      },
      base,
      maps: {
        pages: { abc123: "abc123" },
        users: { owner: "owner@example.test" },
        tokens: {},
        groups: {},
      },
      ids: ["abc123"],
      identitySummary: {},
      groupSummary: {},
      media: null,
      datasets: {
        receipts: [],
        relations: [],
        provenance: {
          baseManifestSha256: "a".repeat(64),
          relationManifestSha256: "b".repeat(64),
          relationExportedAt: "2026-10-22T00:00:00Z",
        },
        verifiedObjects: 0,
        verifiedBytes: 0,
      },
      readArtifact: async () => ({
        ...base,
        artifacts: [page],
        tables: { artifact_versions: [] },
      }),
    };
    const options: MigrationJobOptions = {
      sourceDirectory: "unused",
      indexDirectory: "unused",
      schema: "isolated",
      reportPath: "unused",
      apply: false,
      concurrency: 1,
      origin: "https://new.example.test",
      legacyOrigins: [],
      editorManageRestricted: true,
      conversionStrategy: "archived-functional",
    };
    const module = await readBackendModule(generatedDatasetBackendSource);
    const deployment = sealDeployment(
      generatedDatasetBackendSource,
      "compiled fixture",
      {
        typeDefs: module.typeDefs,
        fields: [
          "read",
          "members",
          "person",
          "mutationAvailability",
          "userChoices",
          "mutate",
          "run",
        ],
      },
    );
    let compiled = 0;
    const result = await prepareMigrationJobDatasets(source, options, {
      host: {
        compile: async () => {
          compiled++;
          return deployment;
        },
        invoke: async () => null,
      },
    });
    assert.ok(result);
    assert.equal(compiled, 1);
    assert.equal(result.issues.size, 0, JSON.stringify([...result.issues]));
    assert.equal(result.metadata.bindings.length, 0);
    assert.equal(result.metadata.acceptedJoins.length, 0);
    const receipts = result.backends.get("abc123");
    assert.equal(receipts?.length, 1);
    assert.equal(receipts[0]?.program, true);
    assert.equal(receipts[0]?.linked, true);
    assert.deepEqual(
      result.metadata.pages.map((p) => ({
        pageId: p.pageId,
        pageVersion: p.pageVersion,
      })),
      [{ pageId: "abc123", pageVersion: 2 }],
    );
    if (native) {
      source.preparedDatasets = result;
      const planner = createMigrationJobPlanner(
        source,
        options,
        async () => {
          throw Error("Native JSON must not enter markup conversion");
        },
        {
          compilerIdentity: "c".repeat(64),
          compiler: async () => {
            throw Error("Native JSON must not enter archived module compiler");
          },
        },
      );
      const plan = await planner(await source.readArtifact("abc123"));
      const planned = plan.pages[0]!;
      assert.equal(planned.disposition, "ready");
      assert.equal(
        planned.revisions[0]!.conversion.classification,
        "functional",
      );
      assert.match(
        planned.revisions[0]!.conversion.html!,
        /data-af-name="legacyData"/,
      );
      assert.match(planned.revisions[0]!.conversion.html!, /client.mutate/);
      const registrations = migrationPageQueryRegistrations(
        planned,
        "fixture",
        options.origin,
      );
      assert.equal(registrations.length, 1);
      assert.equal(registrations[0]!.program?.native?.authority, "owner-only");
      assert.equal(
        registrations[0]!.program?.native?.concurrency,
        "no-overlap",
      );
      assert.deepEqual(registrations[0]!.plan.queries, []);
      assert.equal(registrations[0]!.plan.registration.pageVersion, 2);
    }
  });
