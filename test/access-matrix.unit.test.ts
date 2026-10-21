import { test } from "node:test";
import assert from "node:assert/strict";
import { permissions, updatePolicy } from "../src/access.ts";
import type { AccessPolicy, SharedFile, ShareRole } from "../src/contracts.ts";

const roles: ShareRole[] = ["viewer", "commenter", "editor"];
const file = (access: AccessPolicy): SharedFile =>
  ({ owner: "owner@example.com", access }) as SharedFile;

test("all invitation/link role combinations preserve scoped and anonymous boundaries", () => {
  for (const visibility of ["private", "unlisted", "public"] as const)
    for (const linkRole of roles)
      for (const namedRole of [null, ...roles])
        for (const link of [false, true])
          for (const scoped of [false, true]) {
            const f = file({
              visibility,
              linkRole,
              shares: namedRole ? { "member@example.com": namedRole } : {},
              version: 0,
            });
            const rank = Math.max(
              namedRole ? roles.indexOf(namedRole) : -1,
              link && visibility !== "private" ? roles.indexOf(linkRole) : -1,
            );
            assert.deepEqual(
              permissions(f, "member@example.com", link, scoped),
              {
                role: rank < 0 ? null : roles[rank],
                read: rank >= 0,
                comment: rank >= 1,
                edit: rank >= 2 && !scoped,
                manage: rank >= 2 && !scoped,
              },
              JSON.stringify({ visibility, linkRole, namedRole, link, scoped }),
            );
            const anonymous = permissions(f, null, link, scoped);
            assert.equal(anonymous.read, link && visibility !== "private");
            assert.equal(
              anonymous.comment || anonymous.edit || anonymous.manage,
              false,
            );
            assert.deepEqual(permissions(f, f.owner, link, scoped), {
              role: "owner",
              read: true,
              comment: true,
              edit: !scoped,
              manage: !scoped,
            });
          }
});

test("invitation removal respects remaining link role and does not mutate another file or stale policy", () => {
  const original: AccessPolicy = {
    visibility: "unlisted",
    linkRole: "viewer",
    shares: { "member@example.com": "editor" },
    version: 7,
  };
  const first = file(original),
    second = file(original);
  const changed = updatePolicy(
    first,
    { email: "member@example.com", role: null },
    7,
  );
  first.access = changed;
  assert.equal(permissions(first, "member@example.com", true).role, "viewer");
  assert.equal(permissions(first, "member@example.com", false).read, false);
  assert.equal(permissions(second, "member@example.com", false).role, "editor");
  assert.equal(original.version, 7);
  assert.throws(() => updatePolicy(first, { visibility: "private" }, 7), {
    status: 412,
  });
  first.access = updatePolicy(first, { visibility: "private" }, 8);
  assert.equal(permissions(first, "member@example.com", true).read, false);
  assert.equal(permissions(first, first.owner, true).manage, true);
});

test("invitation capacity permits replacement and removal while rejected additions leave the policy intact", () => {
  const shares = Object.fromEntries(
    Array.from({ length: 200 }, (_, i) => [
      `member${i}@example.com`,
      "viewer" as const,
    ]),
  );
  const f = file({
    visibility: "private",
    linkRole: "viewer",
    shares,
    version: 3,
  });
  const before = structuredClone(f.access);
  assert.throws(
    () => updatePolicy(f, { email: "overflow@example.com", role: "viewer" }, 3),
    { status: 422 },
  );
  assert.deepEqual(f.access, before);
  const replaced = updatePolicy(
    f,
    { email: "MEMBER0@example.com", role: "editor" },
    3,
  );
  assert.equal(Object.keys(replaced.shares).length, 200);
  assert.equal(replaced.shares["member0@example.com"], "editor");
  const removed = updatePolicy(
    file(replaced),
    { email: "member1@example.com", role: null },
    4,
  );
  const added = updatePolicy(
    file(removed),
    { email: "new@example.com", role: "commenter" },
    5,
  );
  assert.equal(Object.keys(added.shares).length, 200);
  assert.deepEqual(f.access, before);
});
