import { test } from "node:test";
import assert from "node:assert/strict";
import { policyFor, permissions, updatePolicy } from "../src/access.ts";
import type { SharedFile, AccessPolicy } from "../src/contracts.ts";
const file = (access?: AccessPolicy) =>
  ({ owner: "owner@example.com", access }) as SharedFile;
const privatePolicy: AccessPolicy = {
  visibility: "private",
  linkRole: "commenter",
  shares: {
    "viewer@example.com": "viewer",
    "commenter@example.com": "commenter",
    "editor@example.com": "editor",
  },
  version: 1,
};
test("private files ignore link capabilities and require named access", () => {
  const f = file(privatePolicy);
  for (const actor of [null, "stranger@example.com"])
    assert.equal(permissions(f, actor, true).read, false);
  assert.equal(permissions(f, "owner@example.com", false).manage, true);
  assert.equal(permissions(f, "viewer@example.com", false).read, true);
  assert.equal(permissions(f, "viewer@example.com", false).comment, false);
  assert.equal(permissions(f, "commenter@example.com", false).comment, true);
  assert.equal(permissions(f, "commenter@example.com", false).edit, false);
  assert.equal(permissions(f, "editor@example.com", false).edit, true);
  assert.equal(
    permissions(f, "editor@example.com", false, true).manage,
    false,
    "file-scoped sessions cannot manage sharing",
  );
});
test("link and invitation roles compose, anonymous users only read, legacy publications retain sharing", () => {
  for (const visibility of ["public", "unlisted"] as const)
    for (const linkRole of ["viewer", "commenter", "editor"] as const) {
      const f = file({ ...privatePolicy, visibility, linkRole });
      assert.equal(permissions(f, null, true).read, true);
      assert.equal(permissions(f, null, true).comment, false);
      assert.equal(
        permissions(f, "stranger@example.com", true).comment,
        linkRole !== "viewer",
      );
      assert.equal(permissions(f, "editor@example.com", true).edit, true);
    }
  assert.equal(policyFor(file()).visibility, "unlisted");
});
test("sharing mutations normalize emails, reject invalid roles, protect owner and require current version", () => {
  const f = file(privatePolicy);
  const added = updatePolicy(
    f,
    { email: " New@Example.COM ", role: "commenter" },
    1,
  );
  assert.equal(added.shares["new@example.com"], "commenter");
  assert.equal(added.version, 2);
  assert.throws(() => updatePolicy(f, { visibility: "public" }, 0), {
    status: 412,
  });
  assert.throws(() =>
    updatePolicy(f, { email: "owner@example.com", role: null }, 1),
  );
  assert.throws(() => updatePolicy(f, { email: "bad", role: "viewer" }, 1));
  assert.throws(() => updatePolicy(f, { linkRole: "admin" } as never, 1));
  const removed = updatePolicy(
    file(added),
    { email: "new@example.com", role: null },
    2,
  );
  assert.equal(removed.shares["new@example.com"], undefined);
  assert.deepEqual(privatePolicy.shares, policyFor(f).shares);
});
