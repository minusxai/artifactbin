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
  assert.deepEqual(result.historicalServiceVersions.get("abc123"), [1]);
  assert.deepEqual(result.statistics, {
    pagesWithImports: 1,
    pagesWithMembers: 0,
    pagesWithViewer: 0,
    headImports: 1,
    historicalImports: 1,
    groupOwnedPages: 0,
    unresolvedPages: 0,
  });
  page.source =
    '<Helmet><Query name="people">{`select user_id from _members`}</Query></Helmet>';
  const members = await scanMigrationDatasetImports(source);
  assert.equal(members.pages.length, 1);
  assert.equal(
    members.pages[0]!.revisions.find((r) => r.version === 2)!.readsMembers,
    true,
  );
  assert.equal(
    members.pages[0]!.revisions.find((r) => r.version === 1)!.readsMembers,
    undefined,
  );
  assert.equal(members.statistics.pagesWithMembers, 1);
  page.source =
    '<Helmet><Query name="people">{`select 1 as _members`}</Query></Helmet>';
  const notMembers = await scanMigrationDatasetImports(source);
  assert.equal(
    notMembers.pages[0]!.revisions.find((r) => r.version === 2)!.readsMembers,
    undefined,
  );
  const readOriginal = source.readArtifact;
  source.readArtifact = async (id) => {
    const artifact = await readOriginal(id);
    if (id === "abc123")
      artifact.tables.artifact_versions = [
        {
          artifact_id: "abc123",
          version: 1,
          format: "markup",
          source:
            '<Helmet><Query name="people">{`select user_id from _members`}</Query></Helmet>',
        },
      ];
    return artifact;
  };
  const historicalMembers = await scanMigrationDatasetImports(source);
  assert.deepEqual(historicalMembers.historicalServiceVersions.get("abc123"), [
    1,
  ]);
  assert.equal(historicalMembers.historicalImportVersions.has("abc123"), false);
  source.readArtifact = async (id) => {
    const artifact = await readOriginal(id);
    if (id === "abc123")
      artifact.tables.artifact_versions = [
        {
          artifact_id: "abc123",
          version: 1,
          format: "markup",
          source:
            '<Helmet><Value name="who" source="ref:data01" column="who"/></Helmet>',
        },
      ];
    return artifact;
  };
  assert.deepEqual(
    (await scanMigrationDatasetImports(source)).historicalServiceVersions.get(
      "abc123",
    ),
    [1],
  );
  for (const [historicalSource, unavailable] of [
    ['<Helmet><Mutation name="save" source="ref:data01">{`insert into rows values (1)`}</Mutation></Helmet>', true],
    ['<Helmet><Query name="rows" source="ref:data01">{`select * from rows`}</Query></Helmet>', true],
    ['<Helmet><Value name="rows" type="table"/><Mutation name="save">{`insert into rows values (1)`}</Mutation></Helmet>', false],
    ['<p>{`<Mutation source="ref:data01"/>`}</p>', false],
  ] as const) {
    source.readArtifact = async (id) => {
      const artifact = await readOriginal(id);
      if (id === "abc123") artifact.tables.artifact_versions = [{artifact_id: "abc123", version: 1, format: "markup", source: historicalSource}];
      return artifact;
    };
    assert.equal((await scanMigrationDatasetImports(source)).historicalServiceVersions.has("abc123"), unavailable);
  }
  source.readArtifact = readOriginal;
  source.maps.users = {};
  const unresolved = await scanMigrationDatasetImports(source);
  assert.equal(unresolved.pages.length, 0);
  assert.equal(unresolved.statistics.unresolvedPages, 1);
});
