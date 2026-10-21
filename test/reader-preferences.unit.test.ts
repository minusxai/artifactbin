import test from "node:test";
import assert from "node:assert/strict";
import { createReaderPreferences } from "../src/browser/reader-preferences.ts";
function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}
test("reader choices survive reopen independently without changing broadcast settings", () => {
  const disk = storage(),
    first = createReaderPreferences(() => disk);
  const defaults = first.read();
  first.set("showCursors", false);
  first.set("showSelections", false);
  const next = createReaderPreferences(() => disk);
  assert.deepEqual(next.read(), {
    ...defaults,
    showCursors: false,
    showSelections: false,
  });
  assert.deepEqual(next.set("showCursors", true), {
    ...defaults,
    showSelections: false,
  });
  const copy = next.read();
  copy.shareCursor = false;
  assert.equal(next.read().shareCursor, true);
});
test("all six choices persist and independent tabs preserve other saved choices", () => {
  const disk = storage(),
    a = createReaderPreferences(() => disk),
    b = createReaderPreferences(() => disk);
  a.set("showCursors", false);
  b.set("shareSelection", false);
  assert.equal(createReaderPreferences(() => disk).read().showCursors, false);
  for (const key of Object.keys(a.read()) as (keyof ReturnType<
    typeof a.read
  >)[])
    a.set(key, false);
  assert.ok(
    Object.values(createReaderPreferences(() => disk).read()).every(
      (value) => value === false,
    ),
  );
});
test("malformed, unavailable and failed storage keep safe defaults and in-memory choices", () => {
  for (const initial of [
    "not json",
    "null",
    "[]",
    '{"showCursors":"false","shareSelection":false,"app":{"token":"private"}}',
  ]) {
    const preferences = createReaderPreferences(() => storage(initial));
    assert.equal(preferences.read().showCursors, true);
    assert.equal(Object.keys(preferences.read()).length, 6);
  }
  for (const access of [
    () => null,
    () => {
      throw Error("blocked");
    },
    () => ({
      getItem() {
        throw Error("denied");
      },
      setItem() {
        throw Error("quota");
      },
    }),
  ]) {
    const preferences = createReaderPreferences(access);
    assert.equal(preferences.set("visible", false).visible, false);
    assert.equal(preferences.read().visible, false);
  }
  const disk = storage();
  const preferences = createReaderPreferences(() => disk);
  disk.setItem = () => {
    throw Error("quota");
  };
  preferences.set("showCursors", false);
  preferences.set("showSelections", false);
  assert.equal(preferences.read().showCursors, false);
});

test("storage disappearing after load preserves prior privacy choices on unrelated updates", () => {
  for (const unavailable of ["null", "throw"] as const) {
    const disk = storage('{"shareCursor":false,"shareSelection":false}');
    let available = true;
    const preferences = createReaderPreferences(() => {
      if (available) return disk;
      if (unavailable === "throw") throw Error("storage unavailable");
      return null;
    });
    available = false;
    const next = preferences.set("showSelections", false);
    assert.equal(next.shareCursor, false);
    assert.equal(next.shareSelection, false);
    assert.equal(next.showSelections, false);
    preferences.set("showCursors", false);
    available = true;
    preferences.set("shareView", false);
    const reopened = createReaderPreferences(() => disk).read();
    assert.equal(reopened.shareCursor, false);
    assert.equal(reopened.shareSelection, false);
    assert.equal(reopened.showSelections, false);
    assert.equal(reopened.showCursors, false);
    assert.equal(reopened.shareView, false);
  }
});

test("a choice in one tab saves only that key and never adopts another tab's choices", () => {
  const disk = storage(),
    a = createReaderPreferences(() => disk),
    b = createReaderPreferences(() => disk);
  b.set("visible", false);
  b.set("shareCursor", false);
  const next = a.set("showCursors", false);
  assert.equal(next.visible, true, "this tab's presence stays as it chose");
  assert.equal(next.shareCursor, true);
  assert.equal(a.read().visible, true);
  assert.deepEqual(createReaderPreferences(() => disk).read(), {
    visible: false,
    shareCursor: false,
    shareView: true,
    showCursors: false,
    shareSelection: true,
    showSelections: true,
  });
});

test("a choice that could not be saved is never replayed over another tab's newer choice", () => {
  const disk = storage();
  let full = false;
  const a = createReaderPreferences(() => ({
    getItem: disk.getItem,
    setItem: (k: string, v: string) => {
      if (full) throw Error("quota");
      disk.setItem(k, v);
    },
  }));
  const b = createReaderPreferences(() => disk);
  full = true;
  a.set("showCursors", false);
  full = false;
  // Another tab chooses after a's unsaved choice, and back again: the stored value is newer.
  b.set("showCursors", false);
  b.set("showCursors", true);
  a.set("shareView", false);
  const reopened = createReaderPreferences(() => disk).read();
  assert.equal(reopened.showCursors, true, "b's later choice stands");
  assert.equal(reopened.shareView, false);
  assert.equal(a.read().showCursors, false, "a keeps its own choice for this session");
});
