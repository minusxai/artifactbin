import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerAuthority } from "../src/group-authority.ts";

test("membership grants authority without impersonating the owning group", () => {
  const facts = { actor: "member@example.test", memberships: [{ owner: "group:one", role: "editor" as const }] };
  assert.deepEqual(ownerAuthority("group:one", true, facts.actor, facts), { group: true, role: "editor", owns: false });
  assert.deepEqual(ownerAuthority("group:one", true, "other@example.test", facts), { group: true, role: null, owns: false });
});
test("removed members and fabricated group sessions have no ownership", () => {
  assert.deepEqual(ownerAuthority("group:one", true, "group:one"), { group: true, role: null, owns: false });
  assert.equal(ownerAuthority("group:one", true, "member@example.test", { actor: "member@example.test", memberships: [] }).role, null);
});
test("personal ownership and prototype-like group identities are exact scalar matches", () => {
  assert.equal(ownerAuthority("owner@example.test", false, "owner@example.test").owns, true);
  for (const owner of ["__proto__", "constructor", "toString"]) {
    assert.equal(ownerAuthority(owner, true, "member", { actor: "member", memberships: [] }).role, null);
    assert.equal(ownerAuthority(owner, true, "member", { actor: "member", memberships: [{ owner, role: "viewer" }] }).role, "viewer");
  }
});

import { permissions } from "../src/access.ts";
const privateGroup = { owner: "group:one", ownerKind: "group" as const, access: { visibility: "private" as const, linkRole: "viewer" as const, shares: {}, version: 0 } };
test("group editor manages, viewer reads, ordinary named editor cannot manage", () => {
  const facts = (role: "viewer" | "editor") => ({ actor: "member", memberships: [{ owner: privateGroup.owner, role }] });
  assert.deepEqual(permissions(privateGroup, "member", false, false, facts("editor")), { role: "owner", read: true, comment: true, edit: true, manage: true });
  assert.deepEqual(permissions(privateGroup, "member", false, false, facts("viewer")), { role: "viewer", read: true, comment: false, edit: false, manage: false });
  assert.equal(permissions(privateGroup, "member", false).read, false);
  assert.equal(permissions({ ...privateGroup, access: { ...privateGroup.access, shares: { member: "editor" } } }, "member", false).manage, false);
  assert.equal(permissions(privateGroup, "member", false, true, facts("editor")).manage, false);
});

import { authorizePageRead } from "../src/server/document-authorization.ts";
test("addressed reads combine fresh group authority with link policy and reject scoped credential confusion", () => {
  const document = { ...privateGroup, shareHash: "hash", generation: 1 };
  const session = { actor: "member", expires: 100, fileId: null, generation: null, groupAuthority: { actor: "member", memberships: [{ owner: privateGroup.owner, role: "viewer" as const }] } };
  assert.equal(authorizePageRead({ document, session, fileId: "abc123", now: 1 }).read, true);
  assert.throws(() => authorizePageRead({ document, session: { ...session, groupAuthority: { actor: "member", memberships: [] } }, fileId: "abc123", now: 1 }));
  assert.throws(() => authorizePageRead({ document, session: { ...session, fileId: "other1", generation: 1 }, fileId: "abc123", now: 1 }));
  assert.throws(() => authorizePageRead({ document, session: { ...session, purpose: "backend" }, fileId: "abc123", now: 1 }));
  assert.throws(() => authorizePageRead({ document, session, fileId: "abc123", now: 101 }));
  assert.equal(authorizePageRead({ document: { ...document, access: { ...document.access, visibility: "unlisted" } }, session: null, fileId: "abc123", now: 1 }).read, true);
});

import { namespaceOwner } from "../src/group-authority.ts";
test("namespace selection keeps actor separate and requires the corresponding membership", () => {
  const facts = { actor: "member", memberships: [{ owner: "group:one", role: "viewer" as const }] };
  assert.equal(namespaceOwner("member", undefined, false, facts), "member");
  assert.equal(namespaceOwner("member", "group:one", false, facts), "group:one");
  assert.throws(() => namespaceOwner("member", "group:one", true, facts));
  assert.throws(() => namespaceOwner("member", "other-user", false, facts));
  assert.throws(() => namespaceOwner("other-user", "group:one", false, facts));
  assert.equal(namespaceOwner("member", "group:one", true, { actor: "member", memberships: [{ owner: "group:one", role: "editor" }] }), "group:one");
});
