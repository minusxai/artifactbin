import test from "node:test";
import assert from "node:assert/strict";
import { preservedOrphanActor } from "../src/migration/orphans.ts";
import { planMigrationIdentities } from "../src/migration/identities.ts";
import { planMigration } from "../src/migration/import.ts";
import { destinationAccess } from "../src/migration/postgres.ts";
import { permissions } from "../src/access.ts";
import { emailAddress } from "../src/email.ts";
import type { MigrationManifest } from "../src/migration/contracts.ts";
test("only exact all-NULL ownership preserves an unclaimable per-artifact principal and unchanged audience", async () => {
  const row = { id: "abc123", user_id: null, group_id: null, token_id: null };
  const actor = preservedOrphanActor("fixture", row)!;
  assert.match(actor, /^legacy-orphan:[a-f0-9]{64}$/);
  assert.equal(actor, preservedOrphanActor("fixture", row));
  assert.notEqual(
    actor,
    preservedOrphanActor("fixture", { ...row, id: "def456" }),
  );
  for (const change of [
    { user_id: "missing" },
    { token_id: "missing" },
    { group_id: "missing" },
    { token_id: undefined },
    { user_id: "" },
  ])
    assert.equal(preservedOrphanActor("fixture", { ...row, ...change }), null);
  assert.throws(() => emailAddress(actor));
  const manifest: MigrationManifest = {
    schemaVersion: 1,
    sourceNamespace: "fixture",
    exportedAt: "",
    tables: {
      users: [],
      artifact_shares: [
        {
          artifact_id: "abc123",
          email: "reader@example.test",
          user_id: null,
          role: "viewer",
        },
      ],
    },
    tokenOwners: [],
    artifacts: [
      {
        ...row,
        version: 1,
        format: "markup",
        source: "<p>Retained</p>",
        document: null,
        visibility: "private",
        link_role: "viewer",
      },
    ],
  };
  const identity = planMigrationIdentities(manifest);
  assert.equal(identity.maps.orphans?.abc123, actor);
  const plan = await planMigration(manifest, {
    maps: identity.maps,
    coreUrl: "/af/v1/core.js",
    convert: () => ({
      classification: "renderable",
      html: "<html><p>Retained</p></html>",
      identities: {},
      issues: [],
    }),
  });
  const page = plan.pages[0]!;
  assert.equal(page.disposition, "ready");
  assert.deepEqual(page.owner, { kind: "orphan", id: actor });
  const access = destinationAccess(page, plan.maps) as any;
  const file = { owner: actor, access };
  assert.equal(permissions(file, null, true).read, false);
  assert.equal(permissions(file, "unrelated@example.test", true).manage, false);
  assert.equal(permissions(file, "reader@example.test", false).read, true);
  access.visibility = "public";
  assert.equal(permissions(file, null, true).read, true);
  assert.equal(permissions(file, null, true).edit, false);
  assert.equal(permissions(file, "unrelated@example.test", true).manage, false);
});
