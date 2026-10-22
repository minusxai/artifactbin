import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPublication,
  localComment,
  acknowledge,
  mergeComments,
  compact,
  acceptComment,
  editComment,
  presenceUpdate,
  visiblePresence,
  capturePresence,
  enterView,
  leaveView,
  replaceSource,
} from "../src/model.ts";
import type {
  DocumentState,
  SharedFile,
  Snapshot,
  CommentDraft,
  PresenceEntry,
  AcceptedComment,
} from "../src/contracts.js";
const doc = (): DocumentState => ({
  format: 1,
  fileId: null,
  remote: null,
  anchors: {},
  publishRequest: "request",
  sourceRevision: "v1",
  comments: [],
  pending: [],
  snapshots: {},
  sources: {},
  app: null,
});
const snap = (count: number): Snapshot => ({
  schema: 1,
  sourceRevision: "v1",
  state: { count },
  view: { x: 0, y: 12 },
});
const file = (): SharedFile => ({
  owner: "alice",
  shareHash: "share",
  head: "v1",
  sources: { v1: "<h1>Old</h1>" },
  comments: {},
  snapshots: {},
  sequence: 0,
  generation: 1,
});
const digest = (value: string) => JSON.stringify(value);
const clock = { now: 100 };
const input = (id = "one"): CommentDraft => ({
  id,
  nodeId: "heading",
  quote: "Old",
  body: "Look",
  sourceRevision: "v1",
  parentId: null,
});
test("offline comments snapshot by value and acknowledgments preserve concurrent pending work", () => {
  const original = doc(),
    snapshot = snap(3);
  const first = localComment(original, input(), snapshot, "local-snapshot");
  snapshot.state.count = 99;
  assert.equal(original.comments.length, 0);
  assert.equal(first.snapshots["local-snapshot"]!.state.count, 3);
  const second = localComment(first, input("two"), snap(4), "local-two");
  const accepted: AcceptedComment = {
    ...input(),
    appStateId: "remote-snapshot",
    publishedBy: "alice",
    createdAt: "now",
    fingerprint: "hash",
    sequence: 1,
    revision: 1,
    resolved: false,
  };
  const ack = acknowledge(second, accepted);
  assert.deepEqual(ack.pending, ["two"]);
  assert.equal(ack.snapshots["remote-snapshot"]!.state.count, 3);
  assert.deepEqual(second.pending, ["one", "two"]);
  const merged = mergeComments(ack, [accepted]);
  assert.equal(merged.comments.length, 2);
  assert.deepEqual(merged.pending, ["two"]);
});
test("compaction retains every pending comment and its context, plus recent acknowledged context", () => {
  let state = doc();
  for (let i = 0; i < 100; i++) {
    state = localComment(state, input(String(i)), snap(i), "s" + i);
    if (i % 7)
      state = acknowledge(state, {
        ...state.comments.at(-1)!,
        publishedBy: "alice",
        fingerprint: "hash",
        sequence: i,
        revision: 1,
        resolved: false,
      });
  }
  const compacted = compact(state, 5);
  assert.deepEqual(compacted.pending, state.pending);
  for (const id of state.pending) {
    const c = compacted.comments.find((c) => c.id === id);
    assert.ok(c);
    assert.ok(compacted.snapshots[c.appStateId!]);
  }
  assert.ok(compacted.comments.length <= state.pending.length + 5);
  assert.ok(
    Object.keys(compacted.snapshots).length <= compacted.comments.length,
  );
  assert.equal(compact(state, 0).comments.length, state.pending.length);
});
test("first sync owns attribution; retries are idempotent across actors and reordered object keys", () => {
  const initial = file(),
    one = acceptComment(initial, "alice", input(), snap(1), {
      digest,
      now: 100,
    });
  assert.equal(initial.sequence, 0);
  assert.equal(one.comment.publishedBy, "alice");
  const retry = acceptComment(
    one.file,
    "bob",
    input(),
    {
      view: { y: 12, x: 0 },
      state: { count: 1 },
      sourceRevision: "v1",
      schema: 1,
    },
    { digest, now: 101 },
  );
  assert.equal(retry.created, false);
  assert.equal(retry.comment.publishedBy, "alice");
  assert.deepEqual(retry.file, one.file);
  assert.throws(
    () =>
      acceptComment(
        one.file,
        "bob",
        { ...input(), body: "Different" },
        snap(1),
        { digest, now: 102 },
      ),
    /conflict/,
  );
  assert.throws(
    () =>
      acceptComment(
        initial,
        "alice",
        input(),
        { ...snap(1), sourceRevision: "missing" },
        { digest, now: 102 },
      ),
    /source/,
  );
});
test("editing requires author or owner and matching revision; replies require an existing parent", () => {
  const first = acceptComment(file(), "alice", input(), snap(1), {
    digest,
    now: 100,
  });
  assert.throws(
    () => editComment(first.file, "bob", false, "one", 1, { body: "no" }),
    /author/,
  );
  assert.throws(
    () => editComment(first.file, "alice", false, "one", 0, { body: "stale" }),
    /changed/,
  );
  const result = editComment(first.file, "alice", false, "one", 1, {
    resolved: true,
  });
  assert.equal(result.comment.resolved, true);
  assert.equal(first.comment.resolved, false);
  assert.throws(
    () =>
      acceptComment(
        file(),
        "alice",
        { ...input("reply"), parentId: "missing" },
        null,
        { digest, now: 100 },
      ),
    /parent/,
  );
});
test("presence uses explicit time, independent privacy controls, revision and generation boundaries", () => {
  let entries: Record<string, PresenceEntry> = {};
  const p = {
    sessionId: "a",
    sourceRevision: "v1",
    snapshot: snap(2),
    cursor: { nodeId: "heading", x: 0.2, y: 0.3 },
  };
  entries = presenceUpdate(entries, "alice", p, {
    now: clock.now,
    generation: 1,
  });
  assert.equal(visiblePresence(entries, { now: 101, generation: 1 }).length, 1);
  const captured = capturePresence(entries, "a", { now: 101, generation: 1 });
  entries = presenceUpdate(
    entries,
    "alice",
    { ...p, snapshot: snap(5) },
    { now: 102, generation: 1 },
  );
  assert.equal(captured.state.count, 2);
  entries = presenceUpdate(
    entries,
    "alice",
    { ...p, shareCursor: false, shareView: false },
    { now: 103, generation: 1 },
  );
  assert.equal(
    visiblePresence(entries, { now: 103, generation: 1 })[0]!.cursor,
    null,
  );
  assert.throws(
    () => capturePresence(entries, "a", { now: 104, generation: 1 }),
    /not sharing/,
  );
  assert.equal(
    visiblePresence(entries, { now: 30103, generation: 1 }).length,
    0,
  );
  assert.equal(visiblePresence(entries, { now: 104, generation: 2 }).length, 0);
  assert.throws(
    () => presenceUpdate(entries, "bob", p, { now: 104, generation: 1 }),
    /another/,
  );
  entries = presenceUpdate(
    entries,
    "alice",
    { ...p, visible: false },
    { now: 104, generation: 1 },
  );
  assert.deepEqual(entries, {});
});
test("one-shot views preserve your first view across multiple snapshots; source edits retain old context", () => {
  const initial = { current: snap(0), own: null };
  const first = enterView(initial, snap(3));
  const second = enterView(first, snap(5));
  assert.equal(leaveView(second).current!.state.count, 0);
  assert.equal(initial.current.state.count, 0);
  const updated = replaceSource(doc(), "old source", "v2");
  assert.equal(updated.sources!.v1, "old source");
  assert.equal(updated.app, null);
  assert.equal(updated.sourceRevision, "v2");
});
test("deterministic interleavings: 1,000 duplicate deliveries never duplicate comments or alter authors", () => {
  let server = file(),
    local = doc();
  for (let i = 0; i < 100; i++)
    local = localComment(local, input(String(i)), snap(i), "s" + i);
  for (let step = 0; step < 1000; step++) {
    const i = (step * 37) % 100,
      c = local.comments.find((c) => c.id === String(i))!,
      result = acceptComment(
        server,
        step < 100 ? "alice" : "bob",
        { ...c, sourceRevision: c.sourceRevision! },
        local.snapshots[c.appStateId!]!,
        { digest, now: step },
      );
    server = result.file;
    local = acknowledge(local, result.comment);
  }
  assert.equal(Object.keys(server.comments).length, 100);
  assert.equal(server.sequence, 100);
  assert.equal(local.pending.length, 0);
  assert.ok(
    Object.values(server.comments).every((c) => c.publishedBy === "alice"),
  );
});

test("publication identity is stable on retry, independent for separate files, and retains old sources", () => {
  const state = { accounts: {}, tokens: {}, files: {}, publications: {} };
  const options = {
    fileId: "one",
    share: "capability",
    digest: (x: string) => "hash:" + x,
    revision: (x: string) => "revision:" + x,
  };
  const request = {
    source: "current",
    requestId: "request",
    sources: { "revision:old": "old" },
  };
  const first = createPublication(state, "alice", request, options);
  assert.equal(first.publication.fileId, "one");
  assert.deepEqual(first.state.files.one!.access, {
    visibility: "private",
    linkRole: "viewer",
    shares: {},
    version: 1,
  });
  assert.equal(first.state.files.one!.sources["revision:old"], "old");
  assert.deepEqual(state.files, {});
  const retry = createPublication(first.state, "alice", request, {
    ...options,
    fileId: "unused",
  });
  assert.equal(retry.created, false);
  assert.equal(retry.publication.fileId, "one");
  const second = createPublication(
    first.state,
    "alice",
    { source: "current", requestId: "separate" },
    { ...options, fileId: "two" },
  );
  assert.equal(second.publication.fileId, "two");
  assert.throws(
    () =>
      createPublication(
        first.state,
        "alice",
        { source: "changed", requestId: "request" },
        options,
      ),
    /changed/,
  );
  assert.throws(
    () =>
      createPublication(
        state,
        "alice",
        { source: "current", requestId: "new", sources: { wrong: "old" } },
        options,
      ),
    /revision/,
  );
});

test("compaction drops unused source/anchor cache but keeps context for pending comments", () => {
  let state = doc();
  state.sources = { v1: "old source", unused: "unused source" };
  state.anchors = { unused: { quote: "unused" } };
  state = localComment(state, input(), snap(1), "snapshot");
  const compacted = compact(state, 0);
  assert.deepEqual(compacted.sources, { v1: "old source" });
  assert.deepEqual(Object.keys(compacted.anchors), ["heading"]);
});

test("static documents capture scroll context without requiring an app store", () => {
  const snapshot: Snapshot = {
    schema: 0,
    sourceRevision: "v1",
    state: {},
    view: { x: 0, y: 900 },
  };
  const result = acceptComment(file(), "alice", input(), snapshot, {
    digest,
    now: 100,
  });
  assert.equal(result.file.snapshots[result.comment.appStateId!]!.view.y, 900);
});

test("reordered sync and duplicate acknowledgments never roll back newer comment edits", () => {
  const local = localComment(doc(), input(), snap(1), "local");
  const accepted = acceptComment(file(), "alice", input(), snap(1), { digest, now: 100 });
  const edited = editComment(accepted.file, "alice", true, "one", 1, { body: "newer" });
  const synced = mergeComments(acknowledge(local, accepted.comment), [edited.comment]);
  assert.equal(mergeComments(synced, [accepted.comment]).comments[0]!.body, "newer");
  assert.equal(acknowledge(synced, accepted.comment).comments[0]!.body, "newer");
  assert.equal(mergeComments(local, [edited.comment]).comments[0]!.publishedBy, null);
});

test("interleaved viewers and multiple tabs retain independent snapshots and privacy", () => {
  let entries: Record<string, PresenceEntry> = {};
  for (let i = 0; i < 100; i++) {
    const sid = i % 2 ? "alice-tab" : "bob-tab";
    entries = presenceUpdate(entries, sid, { sessionId: sid, sourceRevision: "v1", snapshot: snap(i) }, { now: i, generation: 1 });
  }
  const captured = capturePresence(entries, "alice-tab", { now: 100, generation: 1 });
  entries = presenceUpdate(entries, "alice-tab", { sessionId: "alice-tab", sourceRevision: "v1", shareView: false, shareCursor: false }, { now: 101, generation: 1 });
  assert.equal(captured.state.count, 99);
  assert.equal(capturePresence(entries, "bob-tab", { now: 101, generation: 1 }).state.count, 98);
  assert.throws(() => capturePresence(entries, "alice-tab", { now: 101, generation: 1 }), /not sharing/);
});
