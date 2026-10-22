/** Handle rules (src/server/handles-contracts.ts): normalized, then checked before any database write. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SqlClient } from "../../../src/backend/af-backend-contracts.ts";
import { handleProblem, handleStore, normalizeHandle } from "../../../src/server/handles.ts";
import { HANDLE_MAX, HANDLE_MIN, RESERVED_HANDLES } from "../../../src/server/handles-contracts.ts";

test("input is trimmed and lowercased; anything that is not a string is empty", () => {
  assert.equal(normalizeHandle("  Alice-Smith "), "alice-smith");
  assert.equal(normalizeHandle("ABC123"), "abc123");
  for (const value of [undefined, null, 42, {}, ["alice"]]) assert.equal(normalizeHandle(value), "");
});

test("a handle is 3 to 32 lowercase letters, digits and underscores and single inner hyphens", () => {
  for (const ok of ["abc", "_alice", "alice_", "al__ice", "___", "a_-_b", "alice", "alice-smith", "a1-b2-c3", "007", "x".repeat(HANDLE_MAX), "x".repeat(HANDLE_MIN)])
    assert.equal(handleProblem(ok), null, ok);
  for (const short of ["", "ab", "x".repeat(HANDLE_MAX + 1)]) assert.equal(handleProblem(short), "length", short);
  for (const bad of ["-alice", "alice-", "al--ice", "al.ice", "al ice", "alice@example.test", "ålice", "al/ice", "Alice"])
    assert.equal(handleProblem(bad), "characters", bad);
});

test("platform words and the server's top-level routes are reserved", () => {
  for (const word of ["api", "af", "connect", "install", "example", "skills", "health", "admin", "pagegi", "platform-frame", "runtime", "home"]) {
    assert.ok(RESERVED_HANDLES.has(word), word);
    if (word.length >= HANDLE_MIN) assert.equal(handleProblem(word), "reserved", word);
  }
  assert.ok(RESERVED_HANDLES.has("a"));
});

test("a refused handle is 422 before the database is touched", async () => {
  const client: SqlClient = { async query() { assert.fail("an invalid handle must not reach persistence"); } };
  for (const handle of ["ab", "-x-", "admin", "a@b.test", 7, null])
    await assert.rejects(handleStore.set(client, "alice@example.test", handle), { status: 422 }, String(handle));
});
