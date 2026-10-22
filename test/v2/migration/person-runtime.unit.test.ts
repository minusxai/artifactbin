import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompiledPeople } from "../../../src/migration/conversion/compiled/person-runtime.ts";

test("people watches only selected bound values and discards former selections and revoked cards", () => {
  const watches: any[] = [],
    snapshots: any[] = [];
  const people = createCompiledPeople(
    [{ valueName: "owner", backendNamespace: "legacyData" }],
    {
      watch(binding, userId, next, error) {
        const watch = { binding, userId, next, error, stopped: false };
        watches.push(watch);
        return () => {
          watch.stopped = true;
        };
      },
      changed(cards) {
        snapshots.push(cards);
      },
    },
  );
  people.update({ owner: "usr_first", arbitrary: "usr_other" });
  assert.equal(watches.length, 1);
  watches[0].next({ name: "First", handle: "first", image: null });
  assert.equal(snapshots.at(-1).usr_first.name, "First");
  people.update({ owner: "usr_second" });
  assert.equal(watches[0].stopped, true);
  assert.deepEqual(snapshots.at(-1), {});
  watches[0].next({ name: "Stale", handle: null, image: null });
  assert.deepEqual(snapshots.at(-1), {});
  watches[1].next({ name: "Second", handle: null, image: null });
  watches[1].error();
  assert.deepEqual(snapshots.at(-1), {});
  watches[1].next({ name: "Late after error", handle: null, image: null });
  assert.deepEqual(snapshots.at(-1), {});
  people.update({ owner: "usr_second" });
  assert.equal(watches.length, 3);
  watches[2].next({ name: "Fresh reconnect", handle: null, image: null });
  assert.equal(snapshots.at(-1).usr_second.name, "Fresh reconnect");
  people.dispose();
  watches[1].next({ name: "Restored", handle: null, image: null });
  assert.deepEqual(snapshots.at(-1), {});
});

test("people refuses malformed cards and external image URLs without coercing selected IDs", () => {
  let next: (card: unknown) => void = () => {};
  const snapshots: any[] = [];
  const people = createCompiledPeople(
    [{ valueName: "owner", backendNamespace: "legacyData" }],
    {
      watch(_b, _id, notify) {
        next = notify;
        return () => {};
      },
      changed(cards) {
        snapshots.push(cards);
      },
    },
  );
  people.update({ owner: 42 });
  assert.equal(snapshots.length, 0);
  people.update({ owner: "usr_selected" });
  for (const card of [
    { name: "Name", handle: null, image: "https://example.invalid/avatar" },
    { name: 42, handle: null, image: null },
    { name: "Name", handle: null, image: null, secret: true },
    null,
  ]) {
    next(card);
    assert.deepEqual(snapshots.at(-1), {});
  }
  people.dispose();
});

test("duplicate selected IDs remain one public card and scoped image routes remain intact", () => {
  const notify: ((card: unknown) => void)[] = [],
    snapshots: any[] = [];
  const people = createCompiledPeople(
    [
      { valueName: "first", backendNamespace: "legacyData" },
      { valueName: "second", backendNamespace: "legacyData" },
    ],
    {
      watch(_b, _id, next) {
        notify.push(next);
        return () => {};
      },
      changed(cards) {
        snapshots.push(cards);
      },
    },
  );
  people.update({ first: "usr_same", second: "usr_same" });
  const image = "/af/v1/ids/Page01/person-images/first/" + "a".repeat(64);
  notify[0]!({ name: "Public name", handle: "public", image });
  notify[1]!({ name: "Public name", handle: "public", image });
  assert.equal(snapshots.at(-1).usr_same.image, image);
  notify[1]!({ name: "Conflicting name", handle: "public", image });
  assert.deepEqual(snapshots.at(-1), {});
  notify[1]!({ name: "Public name", handle: "public", image });
  notify[0]!(null);
  assert.equal(snapshots.at(-1).usr_same.name, "Public name");
  notify[1]!(null);
  assert.deepEqual(snapshots.at(-1), {});
  people.dispose();
});
