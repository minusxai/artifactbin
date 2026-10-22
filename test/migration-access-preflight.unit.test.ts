import test from "node:test";
import assert from "node:assert/strict";
import { PostgresMigrationDestination } from "../src/migration/postgres.ts";
import { planMigration } from "../src/migration/import.ts";
import {
  migrationOwnershipSourceDigest,
  migrationOwnershipScopeDigest,
} from "../src/migration/ownership-override.ts";
test("offline ownership access preflight uses exact source namespace without opening destination or granting writes", async () => {
  const artifact = {
    id: "page01",
    format: "markup",
    version: 1,
    user_id: null,
    group_id: null,
    token_id: "token",
    source: "<p>Original</p>",
    document: null,
    visibility: "unlisted",
    link_role: null,
  };
  const manifest = {
    schemaVersion: 1 as const,
    sourceNamespace: "fixture",
    exportedAt: "",
    tables: {},
    tokenOwners: [{ id: "token", user_id: null }],
    artifacts: [artifact],
  };
  const maps = {
    users: {},
    groups: {},
    tokens: { token: "legacy-token:" + "a".repeat(64) },
    pages: { page01: "Page01" },
  };
  const input = {
    schemaVersion: 1 as const,
    sourceNamespace: "fixture",
    targetEmail: "owner@example.test",
    entries: [
      {
        legacyId: "page01",
        sourceSha256: migrationOwnershipSourceDigest(artifact),
      },
    ],
  };
  const policy = {
    ...input,
    scopeSha256: migrationOwnershipScopeDigest(input),
  };
  const plan = await planMigration(manifest, {
    maps,
    ownershipOverride: policy,
    coreUrl: "/af/v1/core.js",
    convert: () => ({
      classification: "renderable",
      html: "<!doctype html><html><head></head><body><p>Original</p></body></html>",
      identities: {},
      issues: [],
    }),
  });
  const page = plan.pages[0]!;
  let queries = 0;
  const destination = new PostgresMigrationDestination(
    {
      query: async () => {
        queries++;
        throw Error("Offline preflight cannot query");
      },
    },
    {
      schema: "fixture",
      origin: "https://example.test",
      isolated: false,
      editorManageRestricted: true,
      ownershipOverride: policy,
      sourceNamespace: "fixture",
    },
    maps,
  );
  assert.equal(destination.supportsExactAccess(page), true);
  assert.equal(
    destination.supportsExactAccess({
      ...page,
      owner: { kind: "user", id: "other@example.test" },
    }),
    false,
  );
  await assert.rejects(
    destination.prepare({ manifest, maps }),
    /isolated destination/,
  );
  assert.equal(queries, 0);
  const wrong = new PostgresMigrationDestination(
    {
      query: async () => {
        queries++;
        throw Error("No SQL");
      },
    },
    {
      schema: "fixture",
      origin: "https://example.test",
      isolated: true,
      editorManageRestricted: true,
      ownershipOverride: policy,
      sourceNamespace: "other",
    },
    maps,
  );
  assert.equal(wrong.supportsExactAccess(page), false);
  await assert.rejects(wrong.prepare({ manifest, maps }), /namespace differs/);
  assert.equal(queries, 0);
});
