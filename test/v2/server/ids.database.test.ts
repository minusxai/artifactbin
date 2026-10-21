import { test } from "node:test";
import assert from "node:assert/strict";
import { FILE_ID_PATTERN } from "../../../src/af-contracts.ts";
import { startServer } from "../support/server.ts";

test("POST /api/ids reserves IDs once per Idempotency-Key", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const reserve = (key: string, count: number, auth = token) =>
      server.request("/api/ids", { token: auth, body: { count }, headers: { "Idempotency-Key": key } });
    const first = await reserve("key-one-0000000001", 2);
    assert.equal(first.status, 201);
    const { ids } = (await first.json()) as { ids: string[] };
    assert.equal(ids.length, 2);
    for (const id of ids) assert.match(id, FILE_ID_PATTERN);
    assert.notEqual(ids[0], ids[1]);
    const replay = await reserve("key-one-0000000001", 2);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { ids });
    assert.equal((await reserve("key-one-0000000001", 3)).status, 422);
    const other = (await (await reserve("key-two-0000000002", 1)).json()) as { ids: string[] };
    assert.equal(other.ids.some((id) => ids.includes(id)), false);
    const stranger = await server.token();
    const theirs = await reserve("key-one-0000000001", 2, stranger);
    assert.equal(theirs.status, 201, "keys are per account");
    assert.equal(((await theirs.json()) as { ids: string[] }).ids.some((id) => ids.includes(id)), false);
  } finally {
    await server.close();
  }
});

test("POST /api/ids validates its input and needs a token", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    assert.equal((await server.request("/api/ids", { body: { count: 1 }, headers: { "Idempotency-Key": "k-0000000000000001" } })).status, 401);
    assert.equal((await server.request("/api/ids", { token, body: { count: 1 } })).status, 400);
    for (const count of [0, 101, 1.5, "2"])
      assert.equal(
        (await server.request("/api/ids", { token, body: { count }, headers: { "Idempotency-Key": `k-${String(count)}-000000000000` } })).status,
        400,
        String(count),
      );
  } finally {
    await server.close();
  }
});

test("a reserved but unpublished ID has no page behind it", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const { ids } = (await (await server.request("/api/ids", { token, body: { count: 1 }, headers: { "Idempotency-Key": "k-unpublished-0001" } })).json()) as { ids: string[] };
    assert.equal((await server.request(`/af/v1/ids/${ids[0]}`)).status, 404);
    assert.equal((await server.request(`/api/files/${ids[0]}/source`, { token })).status, 404);
  } finally {
    await server.close();
  }
});
