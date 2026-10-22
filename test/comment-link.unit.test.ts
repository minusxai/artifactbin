import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCommentLink,
  createCommentLink,
} from "../src/browser/comment-link.ts";
import type { CommentThread } from "../src/browser/comment-link-contracts.ts";
const thread = {
  selectedId: "reply",
  rootId: "root",
  comments: [
    { id: "root", parentId: null, resolved: true },
    { id: "reply", parentId: "root" },
  ],
} as CommentThread;
test("comment/thread selectors preserve opaque IDs and reject ambiguous or malformed values", () => {
  assert.equal(parseCommentLink(new URLSearchParams()), null);
  assert.equal(parseCommentLink(new URLSearchParams("comment=reply")), "reply");
  assert.equal(parseCommentLink(new URLSearchParams("thread=root")), "root");
  for (const value of [
    "comment=",
    "thread=a&comment=a",
    "comment=a&comment=b",
    "comment=%00",
    "thread=" + "a".repeat(513),
  ])
    assert.throws(() => parseCommentLink(new URLSearchParams(value)));
});
test("fresh thread read opens selected reply saved context and resolved root beyond bootstrap", async () => {
  const calls: string[] = [];
  const controller = createCommentLink({
    readThread: async (id) => {
      calls.push("read:" + id);
      return thread;
    },
    install: () => calls.push("install"),
    showComment: async (c) => {
      calls.push("context:" + c.id);
    },
    openThread: (root, selected) => calls.push(root + ":" + selected),
    error: (message) => calls.push(message),
  });
  await controller.open(new URLSearchParams("comment=reply"));
  assert.deepEqual(calls, [
    "read:reply",
    "install",
    "root:reply",
    "context:reply",
  ]);
});
test("navigation, revocation and disposal suppress late reads even when transport ignores abort", async () => {
  for (const action of ["invalidate", "dispose"] as const) {
    let resolve!: (value: CommentThread) => void;
    let signal!: AbortSignal;
    const calls: string[] = [];
    const controller = createCommentLink({
      readThread: (_id, s) => {
        signal = s;
        return new Promise((r) => (resolve = r));
      },
      install: () => calls.push("install"),
      showComment: async () => {},
      openThread: () => calls.push("open"),
      error: (message) => calls.push(message),
    });
    const pending = controller.open(new URLSearchParams("comment=reply"));
    controller[action]();
    resolve(thread);
    await pending;
    assert.equal(signal.aborted, true);
    assert.deepEqual(calls, []);
  }
});
test("missing, denied and incomplete threads show errors without opening a cached thread", async () => {
  const calls: string[] = [];
  const controller = createCommentLink({
    readThread: async () => {
      throw Error("Comment not found");
    },
    install: () => calls.push("install"),
    showComment: async () => {},
    openThread: () => calls.push("open"),
    error: (message) => calls.push(message),
  });
  await controller.open(new URLSearchParams("comment=reply"));
  assert.deepEqual(calls, ["Comment not found"]);
});

test("replacement navigation opens only the latest selection", async () => {
  let resolve!: (value: CommentThread) => void;
  const opened: string[] = [];
  const controller = createCommentLink({
    readThread: (id) =>
      id === "reply"
        ? new Promise((r) => (resolve = r))
        : Promise.resolve({ ...thread, selectedId: "root" }),
    install: () => {},
    showComment: async () => {},
    openThread: (_root, id) => opened.push(id),
    error: (message) => opened.push(message),
  });
  const stale = controller.open(new URLSearchParams("comment=reply"));
  await controller.open(new URLSearchParams("thread=root"));
  resolve(thread);
  await stale;
  assert.deepEqual(opened, ["root"]);
});

test("nested replies retain stored order while unrelated and orphan cycles stay outside the thread", async () => {
  const { commentThreadReplies } = await import(
    "../src/browser/comment-link.ts"
  );
  const comments = [
    { id: "deep", parentId: "reply" },
    { id: "root", parentId: null },
    { id: "unrelated", parentId: null },
    { id: "reply", parentId: "root" },
    { id: "cycle-a", parentId: "cycle-b" },
    { id: "cycle-b", parentId: "cycle-a" },
  ] as import("../src/contracts.ts").Comment[];
  assert.deepEqual(
    commentThreadReplies(comments, "root").map((c) => c.id),
    ["deep", "reply"],
  );
});

test("synchronous authority invalidation during installation cannot open or replay the thread", async () => {
  const calls: string[] = [];
  const controller = createCommentLink({
    readThread: async () => thread,
    install: () => {
      calls.push("install");
      controller.invalidate();
    },
    showComment: async () => {
      calls.push("context");
    },
    openThread: () => calls.push("open"),
    error: (message) => calls.push(message),
  });
  await controller.open(new URLSearchParams("comment=reply"));
  assert.deepEqual(calls, ["install"]);
});

test("navigation, revocation and disposal cancel an already pending saved context before it can replay", async () => {
  const { createDocumentView } = await import(
    "../src/browser/document-view.ts"
  );
  for (const action of ["navigation", "invalidate", "dispose"] as const) {
    let resolveContext!: (value: any) => void, started!: () => void;
    const contextStarted = new Promise<void>((resolve) => (started = resolve));
    const mounts: string[] = [];
    const view = createDocumentView({
      source: "live",
      revision: "live",
      snapshot: null,
      contexts: {
        cached: () => ({ sources: {}, snapshots: {} }),
        comment: async () => {
          started();
          return new Promise((resolve) => (resolveContext = resolve));
        },
        viewer: async () => ({ source: null, snapshot: null }),
      },
      surface: { mount: (source) => mounts.push(source), suspend() {} },
      activity: { suspend() {}, resume() {} },
      changed() {},
    });
    const oldThread = {
      ...thread,
      comments: thread.comments.map((c) => ({
        ...c,
        sourceRevision: "old",
        appStateId: "snapshot",
      })),
    };
    let nextReadStarted!: () => void;
    const nextStarted = new Promise<void>(
      (resolve) => (nextReadStarted = resolve),
    );
    const controller = createCommentLink({
      readThread: async (id) => {
        if (id === "next") {
          nextReadStarted();
          return new Promise(() => {});
        }
        return oldThread;
      },
      install() {},
      showComment: (comment, signal) => view.showComment(comment, signal),
      openThread() {},
      error() {},
    });
    const old = controller.open(new URLSearchParams("comment=reply"));
    await contextStarted;
    if (action === "navigation") {
      void controller.open(new URLSearchParams("comment=next"));
      await nextStarted;
    } else controller[action]();
    resolveContext({
      source: "obsolete context",
      snapshot: {
        schema: 0,
        sourceRevision: "old",
        state: {},
        view: { x: 0, y: 0 },
      },
    });
    await old;
    assert.deepEqual(mounts, [], action);
    assert.equal(view.historical, false, action);
    controller.dispose();
    view.dispose();
  }
});
