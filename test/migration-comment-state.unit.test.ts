import test from "node:test";
import assert from "node:assert/strict";
import { projectMigrationCommentState } from "../src/migration/comment-state.ts";
const legacySource =
  '<Helmet><Value name="filter" type="string" default="old"/><Value name="count" type="number" default={1}/></Helmet>';
const input = {
  sourceRevision: "1",
  legacySource,
  initialState: { compiledPage: { filter: "old", count: 1 } },
};
test("declared Values replay only into the exact historical revision seed with explicit default viewport", () => {
  const raw = { v: 2, state: { $: { filter: "saved", count: 3 } } };
  const r = projectMigrationCommentState({ ...input, raw });
  assert.deepEqual(r.snapshot, {
    schema: 1,
    sourceRevision: "1",
    state: { compiledPage: { filter: "saved", count: 3 } },
    view: { x: 0, y: 0 },
  });
  assert.deepEqual(r.status, {
    status: "available",
    viewport: "document-start",
  });
  assert.deepEqual(r.raw, raw);
  assert.deepEqual(input.initialState, {
    compiledPage: { filter: "old", count: 1 },
  });
});
test("unproven named signals and mismatching Values never create partially restored snapshots", () => {
  for (const raw of [
    { v: 2, state: { $: { filter: "saved" }, "mount:open": true } },
    { v: 2, state: { $: { count: "3" } } },
    { v: 2, state: { $: { unknown: 1 } } },
  ]) {
    const r = projectMigrationCommentState({ ...input, raw });
    assert.equal(r.status.status, "unavailable");
    assert.equal(r.snapshot, null);
    assert.deepEqual(r.raw, raw);
  }
});
test("missing original source never falls forward to a current source and unsupported formats remain inert", () => {
  const raw = { v: 2, state: { $: { filter: "saved" } } };
  assert.deepEqual(
    projectMigrationCommentState({ ...input, raw, sourceRevision: null })
      .status,
    { status: "unavailable", reason: "source-unavailable" },
  );
  assert.equal(
    projectMigrationCommentState({ ...input, raw, legacySource: null })
      .snapshot,
    null,
  );
  for (const value of [
    { x: 1, y: 2 },
    { v: 1, state: {} },
    { v: 2, state: {}, extra: 1 },
    { v: 2, state: { $: { count: NaN } } },
  ]) {
    const r = projectMigrationCommentState({ ...input, raw: value });
    assert.equal(r.snapshot, null);
    assert.equal(r.status.status, "unavailable");
  }
});
test("unavailable compiled store and mismatching historical declarations cannot claim replay", () => {
  const raw = { v: 2, state: { $: { filter: "saved" } } };
  assert.equal(
    projectMigrationCommentState({ ...input, raw, initialState: null })
      .snapshot,
    null,
  );
  assert.equal(
    projectMigrationCommentState({
      ...input,
      raw,
      legacySource: legacySource.replace('type="string"', 'type="number"'),
    }).snapshot,
    null,
  );
  const r = projectMigrationCommentState({
    ...input,
    raw: { v: 2, state: {} },
  });
  assert.equal(r.status.status, "available");
});
test("array prototypes, symbols and extra properties are refused without invoking serialization hooks", () => {
  let calls = 0;
  const inherited: unknown[] = [];
  Object.setPrototypeOf(inherited, {
    toJSON() {
      calls++;
      return [];
    },
  });
  const accessor: unknown[] = [];
  Object.defineProperty(accessor, "extra", {
    get() {
      calls++;
      return 1;
    },
  });
  const symbol: unknown[] = [];
  Object.defineProperty(symbol, Symbol("extra"), {
    get() {
      calls++;
      return 1;
    },
  });
  const extra: unknown[] = [];
  Object.defineProperty(extra, "toJSON", {
    value() {
      calls++;
      return [];
    },
  });
  for (const rows of [inherited, accessor, symbol, extra]) {
    const r = projectMigrationCommentState({
      ...input,
      raw: { v: 2, state: { $: { rows } } },
    });
    assert.deepEqual(r.status, {
      status: "unavailable",
      reason: "invalid-state",
    });
    assert.equal(r.snapshot, null);
    assert.equal(calls, 0);
  }
});
