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
  watches[1].next({ name: "Fresh reconnect", handle: null, image: null });
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
  assert.equal(snapshots.at(-1).usr_same.image, null);
  notify[1]!({ name: "Conflicting name", handle: "public", image });
  assert.deepEqual(snapshots.at(-1), {});
  notify[1]!({ name: "Public name", handle: "public", image });
  notify[0]!(null);
  assert.equal(snapshots.at(-1).usr_same.name, "Public name");
  notify[1]!(null);
  assert.deepEqual(snapshots.at(-1), {});
  people.dispose();
});

test("person avatar bytes stay bounded and owned URLs expire with the selected authorization", async () => {
  let next: (v: unknown) => void = () => {};
  const snapshots: any[] = [],
    revoked: string[] = [];
  const loads: { signal: AbortSignal; resolve: (blob: Blob) => void }[] = [];
  const people = createCompiledPeople(
    [{ valueName: "owner", backendNamespace: "legacyData" }],
    {
      watch(_b, _id, n) {
        next = n;
        return () => {};
      },
      changed(v) {
        snapshots.push(v);
      },
      image(_address, signal) {
        return new Promise((resolve) => loads.push({ signal, resolve }));
      },
      objectUrls: {
        create: () => "blob:owned-avatar",
        revoke: (url) => revoked.push(url),
      },
    },
  );
  const image = "/af/v1/ids/Page01/person-images/owner/" + "a".repeat(64);
  people.update({ owner: "usr_first" });
  next({ name: "First", handle: null, image });
  assert.equal(snapshots.at(-1).usr_first.image, null);
  await Promise.resolve();
  loads[0]!.resolve(new Blob(["avatar"], { type: "image/webp" }));
  await new Promise((r) => setImmediate(r));
  assert.equal(snapshots.at(-1).usr_first.image, "blob:owned-avatar");
  people.update({ owner: "usr_second" });
  assert.deepEqual(revoked, ["blob:owned-avatar"]);
  next({ name: "Second", handle: null, image });
  await Promise.resolve();
  people.dispose();
  assert.equal(loads[1]!.signal.aborted, true);
  loads[1]!.resolve(new Blob(["avatar"], { type: "image/webp" }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(snapshots.at(-1), {});
  assert.equal(revoked.length, 1);
});

test("person images reject oversized or non-WebP blobs before creating a URL", async () => {
  let next: (v: unknown) => void = () => {};
  let creates = 0;
  const snapshots: any[] = [];
  let blob = new Blob(["wrong"], { type: "text/html" });
  const people = createCompiledPeople(
    [{ valueName: "owner", backendNamespace: "legacyData" }],
    {
      watch(_b, _id, n) {
        next = n;
        return () => {};
      },
      changed(v) {
        snapshots.push(v);
      },
      image: async () => blob,
      objectUrls: {
        create() {
          creates++;
          return "blob:owned";
        },
        revoke() {},
      },
    },
  );
  people.update({ owner: "usr_selected" });
  const image = "/af/v1/ids/Page01/person-images/owner/" + "a".repeat(64);
  for (const invalid of [
    blob,
    new Blob([], { type: "image/webp" }),
    new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: "image/webp" }),
  ]) {
    blob = invalid;
    next({ name: "Public name", handle: null, image });
    await new Promise((r) => setImmediate(r));
    assert.equal(snapshots.at(-1).usr_selected.image, null);
  }
  assert.equal(creates, 0);
  people.dispose();
});
