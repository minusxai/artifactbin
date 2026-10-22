import test from "node:test";
import assert from "node:assert/strict";
import { planMigrationGroups } from "../src/migration/groups.ts";
import type { MigrationManifest } from "../src/migration/contracts.ts";
test("groups preserve exact membership roles and inactive archives while unresolved authority blocks", () => {
  const m: MigrationManifest = {
    schemaVersion: 1,
    sourceNamespace: "fixture",
    exportedAt: "",
    artifacts: [],
    tokenOwners: [],
    tables: {
      groups: [
        { id: "active", name: "Fixture", created_by: "outsider" },
        { id: "deleted", deleted_at: "epoch" },
        { id: "unknown" },
        { id: "badrole" },
      ],
      group_links: [{ group_id: "active", linked_group_id: "other" }],
      group_members: [
        { group_id: "active", user_id: "u", role: "viewer" },
        { group_id: "deleted", user_id: "u", role: "editor" },
        { group_id: "unknown", user_id: "missing", role: "viewer" },
        { group_id: "badrole", user_id: "u", role: "owner" },
      ],
    },
  };
  const p = planMigrationGroups(m, { u: "user@example.test" });
  assert.equal(p.groups.length, 2);
  assert.equal(p.blocked.length, 2);
  assert.match(p.groups[0]!.actor, /^group:[a-f0-9]{64}$/);
  assert.deepEqual(p.groups[0]!.members, [
    { actor: "user@example.test", role: "viewer" },
  ]);
  assert.equal(p.groups[1]!.active, false);
  assert.equal(
    planMigrationGroups(m, { u: "user@example.test" }).groups[0]!.actor,
    p.groups[0]!.actor,
  );
});
