import test from "node:test";
import assert from "node:assert/strict";
import { wireRequest, wireResult } from "../src/browser/comment-wire.ts";
import { acknowledge, localComment } from "../src/model.ts";
import type { DocumentState } from "../src/contracts.ts";

const page = { version: 3, revision: "digest-3" };
const record = (id: string, version: number, parentId: string | null = null) => ({
  id,
  nodeId: "n7",
  quote: "Milk",
  body: "Buy oat milk",
  parentId,
  version,
  author: "ann@example.test",
  createdAt: "2026-10-20T00:00:00.000Z",
  revision: 0,
  resolved: false,
});

test("a comment from the UI posts the v2 input with the open version, its state and the inert view", () => {
  const request = wireRequest(
    {
      kind: "comments.create",
      comment: {
        id: "local-1",
        nodeId: "n7",
        quote: "Milk",
        body: "Buy oat milk",
        sourceRevision: "digest-3",
        parentId: null,
        appStateId: "s1",
        publishedBy: null,
        createdAt: "",
      },
      snapshot: {
        schema: 0,
        sourceRevision: "digest-3",
        state: { todos: [] },
        view: { x: 0, y: 0 },
        rendered: "<p>Milk</p>",
      },
    },
    page,
  );
  assert.deepEqual(request, {
    path: "/comments",
    method: "POST",
    body: {
      comment: {
        nodeId: "n7",
        quote: "Milk",
        body: "Buy oat milk",
        parentId: null,
        version: 3,
        state: { todos: [] },
        rendered: "<p>Milk</p>",
      },
    },
  });
});

test("server records map to UI comments keyed by the open digest, older versions by number", () => {
  const list = wireResult(
    { kind: "comments.list" },
    { comments: [record("a", 3), record("b", 2, "a")], head: 3 },
    page,
  ) as any;
  assert.equal(list.head, "digest-3");
  assert.deepEqual(
    list.comments.map((c: any) => [c.id, c.sourceRevision, c.publishedBy, c.parentId]),
    [
      ["a", "digest-3", "ann@example.test", null],
      ["b", "2", "ann@example.test", "a"],
    ],
  );
});

test("context responses become a read-only view of what the commenter saw", () => {
  assert.deepEqual(wireRequest({ kind: "context.get", id: "a/b" }, page), {
    path: "/context/a%2Fb",
  });
  const context = wireResult(
    { kind: "context.get", id: "a" },
    { comment: record("a", 2), source: "<p>v2</p>", state: { todos: [1] }, rendered: "<p>x</p>" },
    page,
  ) as any;
  assert.equal(context.source, "<p>v2</p>");
  assert.deepEqual(context.snapshot, {
    schema: 0,
    sourceRevision: "2",
    state: { todos: [1] },
    view: { x: 0, y: 0 },
    rendered: "<p>x</p>",
  });
  const bare = wireResult(
    { kind: "context.get", id: "a" },
    { comment: record("a", 3), source: "<p>v3</p>", state: null },
    page,
  ) as any;
  assert.equal(bare.snapshot, null);
});

test("an acknowledged comment takes the server's ID and its pending replies follow it", () => {
  const empty: DocumentState = {
    format: 1,
    fileId: "Pg4mQ2",
    sourceRevision: "digest-3",
    remote: null,
    anchors: {},
    comments: [],
    pending: [],
    app: null,
    snapshots: {},
    publishRequest: "",
  };
  const draft = (id: string, parentId: string | null) => ({
    id,
    nodeId: "n7",
    quote: "Milk",
    body: "b",
    sourceRevision: "digest-3",
    parentId,
  });
  let state = localComment(empty, draft("local-1", null), null, null, 0);
  state = localComment(state, draft("local-2", "local-1"), null, null, 0);
  const accepted = wireResult(
    { kind: "comments.create", comment: {}, snapshot: null },
    record("server-1", 3),
    page,
  ) as any;
  state = acknowledge(state, accepted, "local-1");
  assert.deepEqual(state.pending, ["local-2"]);
  assert.deepEqual(
    state.comments.map((c) => [c.id, c.parentId, c.publishedBy]),
    [
      ["server-1", null, "ann@example.test"],
      ["local-2", "server-1", null],
    ],
  );
  assert.throws(() => acknowledge(state, accepted, "missing"), /no local comment/);
});

test("resolving and reopening a thread both PUT the comment with its revision", () => {
  assert.deepEqual(wireRequest({ kind: "comments.resolve", id: "c 1", revision: 4 }, page), {
    path: "/comments/c%201",
    method: "PUT",
    body: { resolved: true },
    headers: { "If-Match": "4" },
  });
  assert.deepEqual(wireRequest({ kind: "comments.resolve", id: "c1", revision: 5, resolved: false }, page), {
    path: "/comments/c1",
    method: "PUT",
    body: { resolved: false },
    headers: { "If-Match": "5" },
  });
});

test("unavailable historical comments preserve their thread without borrowing the current page revision", () => {
  const context = { status: "unavailable" as const, originalRevision: "17", reason: "not-retained" as const };
  const historical = { ...record("old", 3, "parent"), version: null, nodeId: null, context };
  const list = wireResult({ kind: "comments.list" }, { comments: [historical], head: 3 }, page) as any;
  assert.equal(list.comments[0].sourceRevision, null);
  assert.equal(list.comments[0].nodeId, null);
  assert.equal(list.comments[0].body, historical.body);
  assert.equal(list.comments[0].parentId, "parent");
  assert.deepEqual(list.comments[0].context, context);
  const view = wireResult({ kind: "context.get", id: "old" }, { comment: historical, context, source: null, state: null, url: null }, page) as any;
  assert.equal(view.source, null);
  assert.equal(view.snapshot, null);
});

test("imported image metadata follows comments without changing body, thread or recorded anchor; ordinary posts cannot attach images", () => {
  const attachments = [{ id: "image-1", name: "Screenshot", variants: [{ variant: "thumbnail", mimeType: "image/webp", width: 20, height: 10, bytes: 5, sha256: "a".repeat(64) }] }];
  const original = { ...record("comment-1", 3), body: "Original body <b>plain text</b>", attachments };
  const result = wireResult({ kind: "comments.list" }, { comments: [original], head: 3 }, page) as { comments: any[] };
  const comment = result.comments[0]!;
  assert.deepEqual(comment.attachments, attachments);
  assert.equal(comment.body, original.body);
  assert.equal(comment.nodeId, "n7");
  assert.equal(comment.sourceRevision, "digest-3");
  assert.equal(comment.parentId, null);
  const posted = wireRequest({ kind: "comments.create", comment, snapshot: null }, page);
  assert.equal(Object.hasOwn((posted.body as {comment: object}).comment, "attachments"), false);
});
