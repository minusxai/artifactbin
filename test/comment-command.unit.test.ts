import test from "node:test";
import assert from "node:assert/strict";
import {
  commentAccess,
  prepareComment,
} from "../src/browser/comment-command.ts";
import type {
  CommentAccessInput,
  CommentCommand,
  CommentCommandContext,
} from "../src/browser/comment-command-contracts.ts";
import type { DocumentState } from "../src/contracts.ts";
const state = (): DocumentState => ({
  format: 1,
  fileId: null,
  remote: null,
  anchors: {},
  sourceRevision: "current",
  publishRequest: "p",
  sources: { old: "<h1>Old</h1>" },
  snapshots: {},
  comments: [],
  pending: [],
  app: null,
});
const access = (): CommentAccessInput => ({
  active: true,
  placement: "portable",
  authenticated: false,
  permission: null,
});
const command = (): CommentCommand => ({
  body: "  Keep whitespace  ",
  selection: { nodeId: "a", quote: "Title", snapshot: null },
  parentId: null,
});
const context = (
  options: Partial<CommentCommandContext> = {},
): CommentCommandContext => {
  let id = 0;
  return {
    access: access(),
    sourceRevision: "current",
    connected: false,
    now: 1000,
    id: () => `id${++id}`,
    ...options,
  };
};
test("comment access covers hosted permission, portable ownership and suspended views independently of authentication", () => {
  for (const placement of ["hosted", "portable"] as const)
    for (const authenticated of [false, true])
      for (const permission of [null, false, true]) {
        assert.equal(
          commentAccess({ active: true, placement, authenticated, permission })
            .allowed,
          placement === "portable" || permission === true,
        );
        const denied = commentAccess({
          active: false,
          placement,
          authenticated,
          permission,
        });
        assert.equal(denied.allowed, false);
        assert.match(denied.notice, /Saved views are read-only/);
      }
  assert.match(
    commentAccess({ ...access(), placement: "hosted" }).notice,
    /Sign in/,
  );
  assert.match(
    commentAccess({ ...access(), placement: "hosted", authenticated: true })
      .notice,
    /view-only/,
  );
});
test("denied, blank, unknown-source and malformed snapshot commands do not allocate identities or mutate persistence", () => {
  const original = state();
  let ids = 0;
  const ctx = context({
    id: () => {
      ids++;
      return "id";
    },
  });
  assert.throws(
    () =>
      prepareComment(original, command(), {
        ...ctx,
        access: { ...access(), active: false },
      }),
    /read-only/,
  );
  assert.throws(
    () => prepareComment(original, { ...command(), body: " \n " }, ctx),
    /empty/,
  );
  const withSnapshot = {
    ...command(),
    selection: {
      ...command().selection,
      snapshot: {
        schema: 1,
        sourceRevision: "missing",
        state: {},
        view: { x: 0, y: 0 },
      },
    },
  };
  assert.throws(() => prepareComment(original, withSnapshot, ctx), /source/);
  assert.throws(
    () =>
      prepareComment(
        original,
        {
          ...withSnapshot,
          selection: {
            ...withSnapshot.selection,
            snapshot: {
              ...withSnapshot.selection.snapshot,
              sourceRevision: "current",
              view: { x: NaN, y: 0 },
            },
          },
        },
        ctx,
      ),
    /JSON|viewport/,
  );
  assert.equal(ids, 0);
  assert.deepEqual(original, state());
});
test("accepted command returns one immutable-context pending change and explicit follow-up sync intent", () => {
  const original = state(),
    input = command();
  input.selection.snapshot = {
    schema: 1,
    sourceRevision: "old",
    state: { value: 1 },
    view: { x: 0, y: 3 },
  };
  const result = prepareComment(original, input, context({ connected: true }));
  assert.equal(result.synchronize, true);
  assert.deepEqual(result.state.pending, [result.id]);
  assert.equal(result.state.comments.length, 1);
  const saved = result.state.comments[0]!;
  assert.equal(saved.body, input.body);
  assert.equal(saved.sourceRevision, "old");
  assert.equal(saved.createdAt, "1970-01-01T00:00:01.000Z");
  assert.equal(saved.publishedBy, null);
  input.selection.snapshot.state.value = 99;
  assert.equal(result.state.snapshots[saved.appStateId!]!.state.value, 1);
  assert.deepEqual(original, state());
  assert.deepEqual(result.state.anchors, { a: { quote: "Title" } });
});
test("static comments use current source without snapshot and offline follow-up does not request network", () => {
  const result = prepareComment(
    state(),
    { ...command(), selection: { nodeId: null, quote: "", snapshot: null } },
    context(),
  );
  assert.equal(result.synchronize, false);
  assert.equal(result.state.comments[0]!.sourceRevision, "current");
  assert.equal(result.state.comments[0]!.appStateId, null);
  assert.deepEqual(result.state.snapshots, {});
  assert.deepEqual(result.state.anchors, {});
});
test("reply parent must be an available unresolved root, and identity collisions never replace snapshots", () => {
  const first = prepareComment(state(), command(), context()).state;
  assert.throws(
    () =>
      prepareComment(first, { ...command(), parentId: "absent" }, context()),
    /thread/,
  );
  const reply = prepareComment(
    first,
    { ...command(), parentId: "id1" },
    context({ id: () => "reply" }),
  );
  assert.equal(reply.state.comments[1]!.parentId, "id1");
  assert.deepEqual(reply.state.pending, ["id1", "reply"]);
  assert.throws(
    () =>
      prepareComment(
        reply.state,
        { ...command(), parentId: "reply" },
        context(),
      ),
    /thread/,
  );
  assert.throws(
    () =>
      prepareComment(
        {
          ...first,
          comments: first.comments.map((c) => ({ ...c, resolved: true })),
        },
        { ...command(), parentId: "id1" },
        context(),
      ),
    /thread/,
  );
  assert.throws(
    () => prepareComment(first, command(), context()),
    /ID conflict/,
  );
  const input = command();
  input.selection.snapshot = {
    schema: 1,
    sourceRevision: "current",
    state: {},
    view: { x: 0, y: 0 },
  };
  assert.throws(
    () =>
      prepareComment(
        { ...state(), snapshots: { id2: input.selection.snapshot! } },
        input,
        context(),
      ),
    /Snapshot ID conflict/,
  );
});
