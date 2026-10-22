import test from "node:test";
import assert from "node:assert/strict";
import { planMigration } from "../src/migration/import.ts";
import type { MigrationManifest } from "../src/migration/contracts.ts";
import type { DatasetBrowserBinding } from "../src/migration/datasets/planner-contracts.ts";
test("conversion receives exact bindings pinned separately for every saved page version", async () => {
  const manifest: MigrationManifest = {
    schemaVersion: 1,
    sourceNamespace: "fixture",
    exportedAt: "epoch",
    tokenOwners: [],
    tables: {
      artifact_versions: [
        { artifact_id: "abc123", version: 1, format: "markup", source: "old" },
      ],
    },
    artifacts: [
      {
        id: "abc123",
        version: 2,
        format: "markup",
        source: "current",
        document: null,
        user_id: "owner",
        group_id: null,
        token_id: "token",
        visibility: "private",
        link_role: "viewer",
      },
    ],
  };
  const seen: number[] = [];
  const boundSeen: unknown[] = [];
  const viewerSeen: unknown[] = [];
  const membersSeen: unknown[] = [];
  const personSeen: unknown[] = [];
  const unavailableSeen: unknown[] = [];
  const binding = (version: number): DatasetBrowserBinding => ({
    name: "rows",
    mode: "live",
    legacyRef: "dataset:fixture",
    backendNamespace: "store",
    backendHref: "/af/v1/ids/def456",
    version,
    tables: [],
  });
  await planMigration(manifest, {
    maps: {
      pages: { abc123: "abc123" },
      users: { owner: "owner@example.test" },
      tokens: {},
      groups: {},
    },
    coreUrl: "/af/v1/core.js",
    datasetBindings: (_id, version) => [binding(version)],
    datasetUnavailable: () => true,
    personBindings: () => [
      { valueName: "who", backendNamespace: "legacyData" },
    ],
    viewerBinding: () => ({
      backendNamespace: "legacyData",
      backendHref: "/af/v1/ids/def456",
    }),
    membersBinding: () => ({
      backendNamespace: "legacyData",
      backendHref: "/af/v1/ids/def456",
    }),
    boundValueColumns: () => [
      {
        valueName: "who",
        sourceRef: "ref:data01",
        version: 3,
        bindingName: "rows",
        schema: "public",
        table: "rows",
        column: "who",
        type: "user",
        constraints: { self: true },
      },
    ],
    convert: (input) => {
      seen.push(input.datasetBindings![0]!.version);
      boundSeen.push(input.boundValueColumns);
      membersSeen.push(input.membersBinding);
      viewerSeen.push(input.viewerBinding);
      personSeen.push(input.personBindings);
      unavailableSeen.push(input.datasetUnavailable);
      return {
        classification: "functional",
        html: "<p>Fixture</p>",
        identities: {},
        issues: [],
      };
    },
  });
  assert.deepEqual(seen, [1, 2]);
  assert.deepEqual(unavailableSeen, [
    { reason: "historical-binding-unavailable" },
    undefined,
  ]);
  assert.deepEqual(membersSeen, [
    undefined,
    { backendNamespace: "legacyData", backendHref: "/af/v1/ids/def456" },
  ]);
  assert.deepEqual(personSeen, [
    undefined,
    [{ valueName: "who", backendNamespace: "legacyData" }],
  ]);
  assert.deepEqual(viewerSeen, [
    undefined,
    { backendNamespace: "legacyData", backendHref: "/af/v1/ids/def456" },
  ]);
  assert.equal(boundSeen[0], undefined);
  assert.deepEqual(boundSeen[1], [
    {
      valueName: "who",
      sourceRef: "ref:data01",
      version: 3,
      bindingName: "rows",
      schema: "public",
      table: "rows",
      column: "who",
      type: "user",
      constraints: { self: true },
    },
  ]);
});
