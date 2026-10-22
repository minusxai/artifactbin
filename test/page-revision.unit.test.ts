import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePageRevision,
  resolvePageRevision,
  pageRevisionQuery,
  readOnlyPagePermissions,
} from "../src/server/page-revision.ts";
test("only an absent version selects head; saved selections remain read-only even at head", () => {
  assert.deepEqual(parsePageRevision(new URLSearchParams()), { kind: "head" });
  const selection = parsePageRevision(new URLSearchParams("version=2"));
  assert.deepEqual(selection, { kind: "saved", version: 2 });
  assert.deepEqual(resolvePageRevision(selection, "2"), {
    version: 2,
    historical: true,
  });
  assert.deepEqual(resolvePageRevision({ kind: "head" }, "3"), {
    version: 3,
    historical: false,
  });
  assert.equal(pageRevisionQuery(selection), "?version=2");
  assert.equal(pageRevisionQuery({ kind: "head" }), "");
});
test("malformed explicit versions never degrade to head", () => {
  for (const query of [
    "version=",
    "version=0",
    "version=-1",
    "version=01",
    "version=1.0",
    "version=1e2",
    "version=abc",
    "version=9007199254740992",
    "version=1&version=2",
    "version=1&version=1",
  ])
    assert.throws(
      () => parsePageRevision(new URLSearchParams(query)),
      (e: any) => e.status === 400,
      query,
    );
});
test("read-only projection preserves read decision but removes every modifying authority", () => {
  const current = {
    read: true,
    edit: true,
    comment: true,
    manage: true,
    role: "owner" as const,
    authorizationContext: "opaque",
  };
  const projected = readOnlyPagePermissions(current);
  assert.deepEqual(projected, {
    read: true,
    edit: false,
    comment: false,
    manage: false,
    role: "owner",
    authorizationContext: null,
  });
  assert.equal(current.edit, true);
});
