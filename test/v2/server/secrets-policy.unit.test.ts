/** Secret-write policy rejects values the backend's text bindings cannot accept, before side effects. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SqlClient } from "../../../src/backend/af-backend-contracts.ts";
import { createSecretsStore } from "../../../src/server/secrets.ts";

const actor = "author@example.test";

test("a NUL in a secret value is 422 before encryption or database writes", async () => {
  const store = createSecretsStore({ cipher: {
    seal() { assert.fail("invalid secrets must not be encrypted"); },
    open() { assert.fail("unused"); },
  } });
  const client: SqlClient = { async query() { assert.fail("invalid secrets must not reach persistence"); } };
  for (const value of ["\0", "\0before", "a\0b", "after\0"])
    await assert.rejects(store.set(client, actor, "API_KEY", value), { status: 422, message: /secret value/i });
});

test("secret values keep their UTF-8 byte limit and allow non-NUL whitespace", async () => {
  const encrypted: string[] = [];
  let queries = 0;
  const store = createSecretsStore({ now: () => 0, cipher: {
    seal(_actor, _name, value) { encrypted.push(value); return "ciphertext"; },
    open() { assert.fail("unused"); },
  } });
  const client: SqlClient = { async query(sql) {
    queries++;
    return { rows: sql.includes("count(*)") ? [{ n: 0 }] : sql.includes("RETURNING") ? [{ name: "API_KEY", updated_at: 0 }] : [], rowCount: 1 };
  } };
  const valid = "é".repeat(2047) + "\r\n";
  assert.equal(Buffer.byteLength(valid, "utf8"), 4096);
  await store.set(client, actor, "API_KEY", valid);
  assert.deepEqual(encrypted, [valid]);
  const before = queries;
  await assert.rejects(store.set(client, actor, "API_KEY", valid + "é"), { status: 422 });
  assert.equal(queries, before, "oversize values must not reach persistence");
  assert.equal(encrypted.length, 1);
});

test("secret writes and the sandbox environment enforce the same name/value boundary", async () => {
  const { checkedBackendEnv } = await import("../../../src/backend/container/env-policy.mjs");
  let writes = 0;
  const client: SqlClient = { async query(sql) {
    return { rows: sql.includes("count(*)") ? [{ n: 0 }] : sql.includes("RETURNING") ? [{ name: "KEY", updated_at: 0 }] : [], rowCount: 1 };
  } };
  const store = createSecretsStore({ now: () => 0, cipher: {
    seal() { writes++; return "ciphertext"; },
    open() { assert.fail("unused"); },
  } });
  for (const [name, value, accepted] of [
    ["KEY", "é".repeat(2048), true], ["Z".repeat(64), "\t\r\n", true],
    ["KEY", "a\0b", false], ["KEY", "é".repeat(2049), false],
    ["KEY", "", false], ["KEY\n", "value", false], ["KEY\r\n", "value", false],
    ["key", "value", false], ["Z".repeat(65), "value", false],
  ] as const) {
    const before = writes;
    if (accepted) {
      assert.deepEqual(checkedBackendEnv({ [name]: value }), { [name]: value });
      await store.set(client, actor, name, value);
      assert.equal(writes, before + 1);
    } else {
      assert.throws(() => checkedBackendEnv({ [name]: value }), TypeError);
      await assert.rejects(store.set(client, actor, name, value), { status: 422 });
      assert.equal(writes, before, "a refused binding must not be encrypted");
    }
  }
});
