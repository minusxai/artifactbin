/**
 * `#af-state=` on a page address: local state carried in a URL, so an agent
 * or a comment can open exactly what someone saw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AF_STATE_URL_LIMIT, type ApolloModule } from "../../../src/apollo/apollo-contracts.ts";
import { load } from "../support/load.ts";

const apollo = () => load<ApolloModule>("src/apollo/client.ts");

test("state round-trips through a URL fragment, including non-ASCII text", async () => {
  const { stateUrl, readStateFragment, encodeState, decodeState } = await apollo();
  const state = { filter: "done", todos: [{ id: "1", text: "Café ☕ — 牛乳", done: true }], n: 1.5, none: null };
  const url = stateUrl("https://artifactbin.dev/af/v1/ids/Pg4mQ2", state);
  assert.match(url, /^https:\/\/artifactbin\.dev\/af\/v1\/ids\/Pg4mQ2#af-state=[A-Za-z0-9_-]+$/);
  const hash = new URL(url).hash;
  assert.deepEqual(readStateFragment(hash), { found: true, state, error: null, rest: "" });
  assert.deepEqual(decodeState(encodeState(state)), state);
  // Exactly what the skill scripts write (Node's base64url: UTF-8 JSON, no padding).
  const scripts = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  assert.equal(encodeState(state), scripts);
  assert.deepEqual(decodeState(scripts + "=="), state, "padding is tolerated");
  // An existing fragment is replaced, never appended to.
  assert.equal(new URL(stateUrl("https://x.test/p#old", {})).hash, "#af-state=" + encodeState({}));
});

test("a fragment without af-state is left alone, and other parts are kept", async () => {
  const { readStateFragment, encodeState } = await apollo();
  assert.deepEqual(readStateFragment(""), { found: false, state: null, error: null, rest: "" });
  assert.deepEqual(readStateFragment("#section-2"), { found: false, state: null, error: null, rest: "#section-2" });
  const mixed = readStateFragment(`#tab=2&af-state=${encodeState({ a: 1 })}`);
  assert.deepEqual(mixed, { found: true, state: { a: 1 }, error: null, rest: "#tab=2" });
});

test("malformed af-state is reported and ignored", async () => {
  const { readStateFragment, decodeState } = await apollo();
  const b64 = (text: string) => Buffer.from(text).toString("base64url");
  for (const bad of ["%%%", "!!", b64("not json"), b64("[1,2]"), b64("42"), b64("null"), ""]) {
    const read = readStateFragment("#af-state=" + bad);
    assert.equal(read.found, true, bad);
    assert.equal(read.state, null, bad);
    assert.ok(read.error, bad);
    assert.throws(() => decodeState(bad), TypeError);
  }
  // Valid JSON that local state cannot hold (a huge exponent is Infinity).
  const read = readStateFragment("#af-state=" + b64('{"n":1e999}'));
  assert.equal(read.state, null);
  assert.match(read.error ?? "", /store/i);
});

test("state over 256 KB is refused when building a URL and ignored when reading one", async () => {
  const { stateUrl, readStateFragment, encodeState } = await apollo();
  const big = { text: "x".repeat(AF_STATE_URL_LIMIT) };
  assert.throws(() => stateUrl("https://x.test/p", big), /256 KB|too large/i);
  assert.throws(() => encodeState(big), TypeError);
  const encoded = Buffer.from(JSON.stringify(big)).toString("base64url");
  const read = readStateFragment("#af-state=" + encoded);
  assert.equal(read.state, null);
  assert.match(read.error ?? "", /too large/i);
  // Just under the limit still works.
  const fits = { t: "y".repeat(AF_STATE_URL_LIMIT - 20) };
  assert.deepEqual(readStateFragment(new URL(stateUrl("https://x.test/p", fits)).hash).state, fits);
});
