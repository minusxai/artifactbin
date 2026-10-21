import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fileName,
  persistentStore,
  standaloneKey,
  viewerStateKey,
  withState,
  type KeyValueStorage,
} from "../../../src/browser/core/standalone.ts";

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

test("a standalone page starts from its saved state and keeps every change in browser storage", async () => {
  const storage = memory();
  const key = standaloneKey("Pg4mQ2", '{"todos":[]}');
  const first = persistentStore({ todos: [] }, key, storage);
  assert.equal(
    (await first.write({ expected: { todos: [] }, next: { todos: ["milk"] } })).status,
    "committed",
  );
  assert.deepEqual(JSON.parse(storage.data.get(key)!), { todos: ["milk"] });
  const reloaded = persistentStore({ todos: [] }, key, storage);
  assert.deepEqual(reloaded.read(), { todos: ["milk"] }, "a reload keeps the change");
});

test("a newer download of the same page starts from its own state, and broken storage falls back to the seed", () => {
  assert.notEqual(standaloneKey("Pg4mQ2", '{"todos":[]}'), standaloneKey("Pg4mQ2", '{"todos":["milk"]}'));
  assert.notEqual(standaloneKey("Pg4mQ2", "{}"), standaloneKey("Ab3dE5", "{}"));
  const storage = memory();
  const key = standaloneKey("Pg4mQ2", "{}");
  storage.setItem(key, "not json");
  assert.deepEqual(persistentStore({ n: 1 }, key, storage).read(), { n: 1 });
  const blocked: KeyValueStorage = {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  };
  assert.deepEqual(persistentStore({ n: 2 }, key, blocked).read(), { n: 2 });
  assert.deepEqual(persistentStore({ n: 3 }, key, null).read(), { n: 3 });
});

test("storage that still reads but no longer writes (quota) never undoes a committed change", async () => {
  const data = new Map<string, string>();
  const key = viewerStateKey("Pg4mQ2");
  data.set(key, JSON.stringify({ n: 1 }));
  const full: KeyValueStorage = {
    getItem: (name) => data.get(name) ?? null,
    setItem: () => {
      throw Error("QuotaExceededError");
    },
  };
  const store = persistentStore({ n: 0 }, key, full);
  assert.deepEqual(store.read(), { n: 1 });
  assert.equal((await store.write({ expected: { n: 1 }, next: { n: 2 } })).status, "committed");
  assert.deepEqual(store.read(), { n: 2 }, "the page keeps working in memory");
  assert.equal((await store.write({ expected: { n: 2 }, next: { n: 3 } })).status, "committed");
  assert.deepEqual(store.read(), { n: 3 });
});

test("an exact write conflicts when the stored copy holds a field it does not expect", async () => {
  const storage = memory();
  const key = viewerStateKey("Pg4mQ2");
  const store = persistentStore({ n: 1 }, key, storage);
  assert.equal((await store.write({ expected: { n: 1, gone: undefined }, next: { n: 2 }, exact: true })).status, "committed");
  storage.data.set(key, JSON.stringify({ n: 2, extra: true }));
  assert.equal((await store.write({ expected: { n: 2 }, next: { n: 3 }, exact: true })).status, "conflict", "another tab added a field");
  assert.equal((await store.write({ expected: { n: 2 }, next: { n: 3 } })).status, "committed", "without the flag, other fields are ignored");
  assert.deepEqual(store.read(), { n: 3, extra: true });
});

test("a hosted page keeps one copy per page for this viewer, whatever version of the page is open", () => {
  assert.equal(viewerStateKey("Pg4mQ2"), viewerStateKey("Pg4mQ2"));
  assert.notEqual(viewerStateKey("Pg4mQ2"), viewerStateKey("Ab3dE5"));
  assert.notEqual(viewerStateKey("Pg4mQ2"), standaloneKey("Pg4mQ2", "{}"), "a downloaded copy never shares it");
});

test("two tabs of the same viewer: each write starts from the latest saved copy, and the other tab sees it", async () => {
  const storage = memory();
  const key = viewerStateKey("Pg4mQ2");
  let notifyOther: (() => void) | undefined;
  const first = persistentStore({ todos: [] }, key, storage);
  const second = persistentStore({ todos: [] }, key, storage, { watch: (changed) => (notifyOther = changed) });
  const seen: unknown[] = [];
  second.subscribe((document) => seen.push(document));
  assert.equal((await first.write({ expected: { todos: [] }, next: { todos: ["a"] } })).status, "committed");
  // The second tab's in-memory copy is stale; its write must not overwrite the first tab's.
  const stale = await second.write({ expected: { todos: [] }, next: { todos: ["b"] } });
  assert.equal(stale.status, "conflict");
  assert.deepEqual(stale.document, { todos: ["a"] }, "the conflict carries the latest saved copy");
  const retried = await second.write({ expected: { todos: ["a"] }, next: { todos: ["a", "b"] } });
  assert.equal(retried.status, "committed");
  assert.deepEqual(JSON.parse(storage.data.get(key)!), { todos: ["a", "b"] });
  // A change saved by another tab reaches this tab's listeners.
  storage.setItem(key, JSON.stringify({ todos: ["c"] }));
  notifyOther!();
  assert.deepEqual(second.read(), { todos: ["c"] });
  assert.deepEqual(seen.at(-1), { todos: ["c"] });
});

test("state loaded from a URL replaces the viewer's copy and is kept", () => {
  const storage = memory();
  const key = viewerStateKey("Pg4mQ2");
  storage.setItem(key, JSON.stringify({ filter: "all" }));
  const loaded = persistentStore({}, key, storage, { replace: { filter: "done" } });
  assert.deepEqual(loaded.read(), { filter: "done" });
  assert.deepEqual(JSON.parse(storage.data.get(key)!), { filter: "done" });
  assert.deepEqual(persistentStore({}, key, storage).read(), { filter: "done" }, "a reload keeps it");
});

test("a downloaded file's state block is replaced by the viewer's state", () => {
  const html = `<!DOCTYPE html><html><head><script data-af="core">x</script><script type="application/json" data-af="state">{"todos":[]}</script></head><body><p>Hi</p></body></html>`;
  const out = withState(html, { todos: ["</script><b>"] });
  assert.ok(out.includes(`data-af="state">{"todos":["\\u003c/script>\\u003cb>"]}</script>`), out);
  assert.equal((out.match(/data-af="state"/g) ?? []).length, 1);
  const without = withState(`<html><head></head><body></body></html>`, { a: 1 });
  assert.ok(without.includes(`<script type="application/json" data-af="state">{"a":1}</script></head>`), without);
});

test("downloaded files are named after the page", () => {
  assert.equal(fileName("Team todo list"), "Team todo list.html");
  assert.equal(fileName("notes.html"), "notes.html");
  assert.equal(fileName('a/b:c*"d'), "a b c d.html");
  assert.equal(fileName(""), "page.html");
  assert.equal(fileName(null), "page.html");
});
