import test from "node:test";
import assert from "node:assert/strict";
import { scanMigrationDatasetImports } from "../src/migration/dataset-scan.ts";
import type { MigrationJobSource } from "../src/migration/job-contracts.ts";
import type {
  MigrationManifest,
  LegacyArtifact,
} from "../src/migration/contracts.ts";
test("dataset scan retains literal dependencies and pins initial receipt to trusted inventory only", async () => {
  const page: LegacyArtifact = {
    id: "abc123",
    version: 2,
    format: "markup",
    source:
      '<Helmet><Import name="sales" src="ref:data01"/></Helmet><p>Current</p>',
    document: null,
    user_id: "owner",
    group_id: null,
    token_id: "token",
    visibility: "private",
    link_role: "viewer",
  };
  const manifest: MigrationManifest = {
    schemaVersion: 1,
    sourceNamespace: "fixture",
    exportedAt: "epoch",
    tables: {},
    artifacts: [],
    tokenOwners: [],
  };
  const source: MigrationJobSource = {
    manifest: {
      schemaVersion: 2,
      sourceNamespace: "fixture",
      schema: "legacy",
      exportedAt: "epoch",
      parts: [],
    },
    base: manifest,
    maps: {
      pages: { abc123: "abc123", data01: "data01" },
      users: { owner: "owner@example.test" },
      tokens: {},
      groups: {},
    },
    ids: ["abc123", "data01"],
    identitySummary: {},
    groupSummary: {},
    media: null,
    readArtifact: async (id) =>
      id === "abc123"
        ? {
            ...manifest,
            artifacts: [page],
            tables: {
              artifact_versions: [
                {
                  artifact_id: "abc123",
                  version: 1,
                  format: "markup",
                  source:
                    '<Helmet><Import name="sales" src="ref:data01"/></Helmet>',
                },
              ],
            },
          }
        : id === "data01"
          ? {
              ...manifest,
              artifacts: [
                {
                  ...page,
                  id: "data01",
                  version: 3,
                  format: "dataset",
                  source: null,
                },
              ],
            }
          : Promise.reject(new Error("missing")),
  };
  const result = await scanMigrationDatasetImports(source);
  assert.equal(result.pages.length, 1);
  assert.deepEqual(
    result.pages[0]!.revisions.map((r) =>
      r.imports.map((i) => i.datasetVersion),
    ),
    [[], [3]],
  );
  assert.deepEqual(result.historicalImportVersions.get("abc123"), [1]);
  assert.deepEqual(result.statistics, {
    pagesWithImports: 1,
    headImports: 1,
    historicalImports: 1,
    groupOwnedPages: 0,
    unresolvedPages: 0,
  });
  source.maps.users = {};
  const unresolved = await scanMigrationDatasetImports(source);
  assert.equal(unresolved.pages.length, 0);
  assert.equal(unresolved.statistics.unresolvedPages, 1);
});
