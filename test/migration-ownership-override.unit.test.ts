import test from "node:test";
import assert from "node:assert/strict";
import {
  migrationOwnershipSourceDigest,
  migrationOwnershipScopeDigest,
  resolveMigrationOwnership,
  validateMigrationOwnershipOverride,
} from "../src/migration/ownership-override.ts";
import type { LegacyArtifact } from "../src/migration/contracts.ts";
import type { MigrationOwnershipOverride } from "../src/migration/ownership-override-contracts.ts";
const artifact = {
  id: "page-a",
  format: "markup",
  version: 1,
  visibility: "unlisted",
  token_id: "token-a",
  source: "original",
} as LegacyArtifact;
const owner = { kind: "token" as const, id: "legacy-token:" + "a".repeat(64) };
function policy(): MigrationOwnershipOverride {
  const input = {
    schemaVersion: 1 as const,
    sourceNamespace: "fixture",
    targetEmail: "owner@example.test",
    entries: [
      {
        legacyId: artifact.id,
        sourceSha256: migrationOwnershipSourceDigest(artifact),
      },
    ],
  };
  return { ...input, scopeSha256: migrationOwnershipScopeDigest(input) };
}
test("exact ownership assignment preserves source and records prior authority", () => {
  const before = structuredClone(artifact);
  const p = policy();
  validateMigrationOwnershipOverride(p, "fixture", [artifact.id]);
  const result = resolveMigrationOwnership(artifact, "fixture", owner, p);
  assert.deepEqual(result.owner, { kind: "user", id: "owner@example.test" });
  assert.deepEqual(result.ownershipAssignment?.originalOwner, owner);
  assert.equal(result.ownershipAssignment?.scopeSha256, p.scopeSha256);
  assert.deepEqual(artifact, before);
  assert.deepEqual(
    resolveMigrationOwnership(
      { ...artifact, id: "other" },
      "fixture",
      owner,
      p,
    ),
    { owner },
  );
});
test("scope rejects tampering, missing source IDs and changed source bytes", () => {
  const p = policy();
  assert.throws(() =>
    validateMigrationOwnershipOverride(
      { ...p, targetEmail: "different@example.test" },
      "fixture",
      [artifact.id],
    ),
  );
  assert.throws(() =>
    validateMigrationOwnershipOverride(p, "other", [artifact.id]),
  );
  assert.throws(() => validateMigrationOwnershipOverride(p, "fixture", []));
  assert.throws(() =>
    resolveMigrationOwnership(
      { ...artifact, source: "changed" },
      "fixture",
      owner,
      p,
    ),
  );
});
test("assignment cannot select login owners, groups, deleted pages or other formats", () => {
  const p = policy();
  for (const bad of [
    { kind: "user" as const, id: "existing@example.test" },
    { kind: "group" as const, id: "legacy-token:" + "a".repeat(64) },
  ])
    assert.throws(() => resolveMigrationOwnership(artifact, "fixture", bad, p));
  for (const change of [{ deleted_at: "yesterday" }, { format: "program" }]) {
    const a = { ...artifact, ...change };
    const input = {
      ...p,
      entries: [
        { legacyId: a.id, sourceSha256: migrationOwnershipSourceDigest(a) },
      ],
    };
    assert.throws(() =>
      resolveMigrationOwnership(a, "fixture", owner, {
        ...input,
        scopeSha256: migrationOwnershipScopeDigest(input),
      }),
    );
  }
});

test("planner changes only selected runtime ownership and preserves archive, visibility and revisions", async () => {
  const { planMigration, migrationPageDigest } = await import(
    "../src/migration/import.ts"
  );
  const source = {
    ...artifact,
    version: 2,
    user_id: null,
    group_id: null,
    document: null,
    link_role: null,
  };
  const untouched = { ...source, id: "page-b", visibility: "public" };
  const manifest = {
    schemaVersion: 1 as const,
    sourceNamespace: "fixture",
    exportedAt: "",
    artifacts: [source, untouched],
    tables: {
      artifact_versions: [
        { ...source, artifact_id: source.id, version: 1, source: "historical" },
      ],
    },
    tokenOwners: [],
  };
  const input = {
    ...policy(),
    entries: [
      {
        legacyId: source.id,
        sourceSha256: migrationOwnershipSourceDigest(source),
      },
    ],
  };
  const p = { ...input, scopeSha256: migrationOwnershipScopeDigest(input) };
  const options = {
    maps: { pages: {}, users: {}, groups: {}, tokens: { "token-a": owner.id } },
    coreUrl: "/af/v1/core.js",
    convert: () => ({
      classification: "renderable" as const,
      html: "<html><p>Fixture</p></html>",
      identities: {},
      issues: [],
    }),
  };
  const original = await planMigration(manifest, options);
  const assigned = await planMigration(manifest, {
    ...options,
    ownershipOverride: p,
  });
  assert.equal(assigned.pages[0]!.owner!.id, p.targetEmail);
  assert.deepEqual(assigned.pages[1], original.pages[1]);
  assert.deepEqual(assigned.archive, original.archive);
  assert.deepEqual(assigned.maps, original.maps);
  assert.deepEqual(assigned.pages[0]!.revisions, original.pages[0]!.revisions);
  assert.deepEqual(assigned.pages[0]!.access, original.pages[0]!.access);
  assert.notEqual(
    migrationPageDigest(assigned.pages[0]!),
    migrationPageDigest(original.pages[0]!),
  );
});
