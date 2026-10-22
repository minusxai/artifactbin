import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./postgres.js";
import { planMigration, migrationPageDigest } from "../src/migration/import.ts";
import { PostgresMigrationDestination } from "../src/migration/postgres.ts";
import {
  migrationOwnershipSourceDigest,
  migrationOwnershipScopeDigest,
} from "../src/migration/ownership-override.ts";
import type { MigrationManifest } from "../src/migration/contracts.ts";
test("assigned runtime owner, immutable source archive and transactional assignment audit survive exact retry", async () => {
  const env = await testDatabase();
  const client = await env.pool.connect();
  try {
    const artifact = {
      id: "abc123",
      format: "markup",
      version: 1,
      user_id: null,
      group_id: null,
      token_id: "t",
      source: "<p>Original</p>",
      document: null,
      visibility: "unlisted",
      link_role: null,
    };
    const manifest: MigrationManifest = {
      schemaVersion: 1,
      sourceNamespace: "fixture",
      exportedAt: "",
      tables: {},
      tokenOwners: [{ id: "t", user_id: null }],
      artifacts: [artifact],
    };
    const maps = {
      users: {},
      groups: {},
      tokens: { t: "legacy-token:" + "a".repeat(64) },
      pages: { abc123: "abc123" },
    };
    const input = {
      schemaVersion: 1 as const,
      sourceNamespace: "fixture",
      targetEmail: "owner@example.test",
      entries: [
        {
          legacyId: "abc123",
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
    assert.equal(page.disposition, "ready");
    const destination = new PostgresMigrationDestination(client, {
      schema: env.schema,
      origin: "https://example.test",
      isolated: true,
      editorManageRestricted: true,
      ownershipOverride: policy,
    });
    await destination.prepare({ manifest, maps });
    assert.equal(destination.supportsExactAccess(page), true);
    assert.equal(
      destination.supportsExactAccess({
        ...page,
        owner: { kind: "user", id: "other@example.test" },
      }),
      false,
    );
    assert.equal(
      await destination.importPage(
        "fixture:abc123",
        migrationPageDigest(page),
        page,
      ),
      "created",
    );
    assert.equal(
      await destination.importPage(
        "fixture:abc123",
        migrationPageDigest(page),
        page,
      ),
      "unchanged",
    );
    const row = (
      await client.query("SELECT owner,access FROM files WHERE id=$1", [
        "abc123",
      ])
    ).rows[0];
    assert.equal(row.owner, policy.targetEmail);
    assert.equal(row.access.visibility, "unlisted");
    const audit = (
      await client.query(
        `SELECT assignment FROM "${env.schema}_migration".ownership_assignments`,
      )
    ).rows;
    assert.equal(audit.length, 1);
    assert.deepEqual(audit[0].assignment, page.ownershipAssignment);
    const archive = (
      await client.query(
        `SELECT manifest FROM "${env.schema}_migration".archives`,
      )
    ).rows[0].manifest;
    assert.deepEqual(archive, manifest);
    await assert.rejects(
      destination.importPage("fixture:abc123", "changed", page),
      /conflicts/,
    );
  } finally {
    client.release();
    await env.pool.query(
      `DROP SCHEMA IF EXISTS "${env.schema}_migration" CASCADE`,
    );
    await env.cleanup();
  }
});
