import { test } from "node:test";
import assert from "node:assert/strict";
import { createCollaborationSession } from "../src/browser/collaboration-session.ts";
import { publicationGate } from "../src/browser/lifecycle.ts";
import type { DocumentState, AcceptedComment } from "../src/contracts.ts";
import type {
  LiveCallbacks,
  SessionTransport,
} from "../src/browser/collaboration-session-contracts.ts";
const initial = (): DocumentState => ({
  format: 1,
  fileId: "doc",
  sourceRevision: "r",
  remote: { origin: "https://example.invalid", share: "read" },
  anchors: {},
  comments: [],
  pending: [],
  app: null,
  snapshots: {},
  publishRequest: "publish",
});
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const permission = {
  role: "owner" as const,
  read: true,
  comment: true,
  edit: true,
  manage: true,
};
const accepted = (id: string): AcceptedComment => ({
  id,
  nodeId: null,
  quote: "",
  body: id,
  sourceRevision: "r",
  parentId: null,
  appStateId: null,
  publishedBy: "owner",
  createdAt: "now",
  revision: 1,
  resolved: false,
  fingerprint: id,
  sequence: 1,
});
function fixture(handler?: (op: any, signal: AbortSignal) => Promise<any>) {
  let state = initial(),
    live: LiveCallbacks | undefined,
    closes = 0, invalidations = 0, readyNotifications = 0;
  const calls: string[] = [],
    changes: any[] = [];
  const transport: SessionTransport = {
    request: async (op, signal) => {
      calls.push(op.kind);
      if (handler) return handler(op, signal);
      return (
        op.kind === "permissions"
          ? permission
          : op.kind === "comments.list"
            ? { comments: [], head: "r" }
            : {}
      ) as any;
    },
    connect(callbacks) {
      live = callbacks;
      return {
        close() {
          closes++;
        },
        send() {
          return true;
        },
      };
    },
  };
  const session = createCollaborationSession({
    gate: publicationGate(),
    readState: () => state,
    updateState(fn) {
      state = fn(state);
    },
    authenticated: () => true,
    onChange: (s) => changes.push(s),
    onInvalidated: () => { invalidations++; },
    onReady: () => { readyNotifications++; },
  });
  session.attach(transport);
  return {
    session,
    transport,
    calls,
    changes,
    get live() {
      return live!;
    },
    get invalidations() { return invalidations; },
    get readyNotifications() { return readyNotifications; },
    get closes() {
      return closes;
    },
    get state() {
      return state;
    },
    set state(v) {
      state = v;
    },
  };
}
test("sync coalesces callers into a shared drain and reads newly queued work on second pass", async () => {
  const first = deferred<any>();
  let permissions = 0;
  const f = fixture(async (op) =>
    op.kind === "permissions"
      ? ++permissions === 1
        ? first.promise
        : permission
      : op.kind === "comments.list"
        ? { comments: [], head: "r" }
        : op.kind === "comments.create"
          ? accepted(op.comment.id)
          : {},
  );
  const a = f.session.synchronize(),
    b = f.session.synchronize();
  let done = false;
  b.then(() => {
    done = true;
  });
  await Promise.resolve();
  assert.equal(done, false);
  f.state = { ...f.state, comments: [accepted("new")], pending: ["new"] };
  first.resolve(permission);
  await Promise.all([a, b]);
  assert.equal(permissions, 2);
  assert.deepEqual(f.state.pending, []);
  assert.equal(f.session.getStatus().sync, "synced");
});
test("suspend settles abort-ignoring requests, stale finally cannot change resumed run", async () => {
  const old = deferred<any>(),
    fresh = deferred<any>();
  let n = 0;
  const f = fixture(async (op) =>
    op.kind === "permissions"
      ? ++n === 1
        ? old.promise
        : fresh.promise
      : op.kind === "comments.list"
        ? { comments: [], head: "r" }
        : {},
  );
  const oldRun = f.session.synchronize();
  f.session.suspend();
  await oldRun;
  assert.equal(f.session.getStatus().mode, "suspended");
  f.session.resume();
  const newRun = f.session.synchronize();
  old.resolve(permission);
  await Promise.resolve();
  assert.equal(f.session.getStatus().sync, "syncing");
  fresh.resolve(permission);
  await newRun;
  assert.equal(f.session.getStatus().sync, "synced");
});
test("partial acknowledgement remains committed when later write fails; concurrent local work survives", async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture(async (op) => {
    if (op.kind === "permissions") return permission;
    if (op.kind === "comments.create") {
      if (op.comment.id === "a") {
        f.state = {
          ...f.state,
          comments: [...f.state.comments, accepted("c")],
          pending: [...f.state.pending, "c"],
        };
        return accepted("a");
      }
      throw Error("offline");
    }
    return {};
  });
  f.state = {
    ...f.state,
    comments: [accepted("a"), accepted("b")],
    pending: ["a", "b"],
  };
  await assert.rejects(f.session.synchronize(), /offline/);
  assert.deepEqual(f.state.pending, ["b", "c"]);
  assert.equal(f.session.getStatus().sync, "error");
});
test("old live callbacks are ignored and history never publishes", async () => {
  const f = fixture();
  const old = f.live;
  f.session.restart();
  old.viewers([{ actor: "stale" } as any]);
  assert.deepEqual(f.session.getStatus().viewers, []);
  f.session.suspend();
  old.ready();
  old.changed();
  f.session.publishPresence({ sessionId: "x" });
  assert.equal(f.calls.length, 0);
  assert.equal(f.closes, 2);
  f.session.dispose();
  f.session.resume();
  assert.equal(f.session.getStatus().mode, "disposed");
  await assert.rejects(
    f.session.request({ kind: "permissions" }),
    /obsolete|suspended/,
  );
});
test("latest profiles win and observer failure does not break synchronization", async () => {
  const first = deferred<any>(),
    second = deferred<any>();
  let n = 0;
  const f = fixture(async (op) =>
    op.kind === "profiles.list"
      ? ++n === 1
        ? first.promise
        : second.promise
      : op.kind === "permissions"
        ? permission
        : { comments: [], head: "r" },
  );
  const a = f.session.refreshProfiles(),
    b = f.session.refreshProfiles();
  second.resolve({ new: { displayName: "new" } });
  await b;
  first.resolve({ old: { displayName: "old" } });
  await a;
  assert.ok(f.state.profiles?.new);
  assert.equal(f.state.profiles?.old, undefined);
});
test("requests own payload and result data across asynchronous adapter boundaries", async () => {
  const response = { ...permission };
  let received: any;
  const f = fixture(async (op) => {
    received = op;
    return response;
  });
  const operation = { kind: "context.get" as const, id: "original" };
  const pending = f.session.request(operation);
  operation.id = "changed";
  const result = await pending;
  assert.equal(received.id, "original");
  response.read = false;
  assert.equal((result as any).read, true);
  assert.ok(Object.isFrozen(result));
});
test("injected timeout settles an ignoring adapter and removes timer resources", async () => {
  const timers = new Map<number, () => void>();
  let serial = 0;
  let signal: AbortSignal | undefined;
  const session = createCollaborationSession({
    gate: publicationGate(),
    readState: initial,
    updateState() {},
    authenticated: () => false,
    clock: {
      setTimeout(fn) {
        timers.set(++serial, fn);
        return serial;
      },
      clearTimeout(id) {
        timers.delete(id as number);
      },
    },
    timeoutMs: 5,
  });
  session.attach({
    request: (_op, s) => {
      signal = s;
      return new Promise(() => {});
    },
    connect: () => ({ close() {}, send() {} }),
  });
  const pending = session.request({ kind: "permissions" });
  await Promise.resolve();
  [...timers.values()][0]!();
  await assert.rejects(pending, /timed out/);
  assert.equal(signal?.aborted, true);
  assert.equal(timers.size, 0);
});
test("synchronous live ready publishes after connection assignment, observer exceptions are isolated", async () => {
  let sends = 0,
    state = initial();
  const session = createCollaborationSession({
    gate: publicationGate(),
    readState: () => state,
    updateState(fn) {
      state = fn(state);
    },
    authenticated: () => false,
    onChange() {
      throw Error("observer");
    },
    onReady() {
      session.publishPresence({ sessionId: "s" });
    },
  });
  session.attach({
    request: async (op) =>
      (op.kind === "permissions"
        ? permission
        : op.kind === "comments.list"
          ? { comments: [], head: "r" }
          : {}) as any,
    connect(callbacks) {
      callbacks.ready();
      return {
        close() {},
        send() {
          sends++;
        },
      };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sends, 1);
  assert.equal(session.getStatus().sync, "synced");
  session.dispose();
});
test("synchronous status observer can suspend during open; returned connection is closed", async () => {
  let closed = 0,
    once = true;
  const session = createCollaborationSession({
    gate: publicationGate(),
    readState: initial,
    updateState() {},
    authenticated: () => false,
    onChange() {
      if (once) {
        once = false;
        session.suspend();
      }
    },
  });
  session.attach({
    request: async () => {
      throw Error("must not request");
    },
    connect(callbacks) {
      callbacks.status("connecting");
      callbacks.ready();
      return {
        close() {
          closed++;
        },
        send() {},
      };
    },
  });
  await Promise.resolve();
  assert.equal(closed, 1);
  assert.equal(session.getStatus().mode, "suspended");
});
test("transport replacement aborts previous callers and permission denial retains queued work", async () => {
  const f = fixture(() => new Promise(() => {}));
  const old = f.session.request({ kind: "context.get", id: "c" });
  f.session.attach({
    request: async (op) =>
      (op.kind === "permissions"
        ? { ...permission, comment: false }
        : op.kind === "comments.list"
          ? { comments: [], head: "r" }
          : {}) as any,
    connect: () => ({ close() {}, send() {} }),
  });
  await assert.rejects(old, /obsolete/);
  f.state = { ...f.state, comments: [accepted("x")], pending: ["x"] };
  await f.session.synchronize();
  assert.deepEqual(f.state.pending, ["x"]);
  assert.equal(f.session.getStatus().sync, "pending");
});
test("cursor updates use the lightweight channel and are suppressed during history", () => {
  const f = fixture();
  const cursors: any[] = [],
    presence: any[] = [];
  f.session.attach({
    ...f.transport,
    connect: () => ({
      close() {},
      send(value) {
        presence.push(value);
      },
      cursor(value) {
        cursors.push(value);
      },
    }),
  });
  f.session.publishCursor({ nodeId: "n", x: 1, y: 2 });
  assert.deepEqual(cursors, [{ nodeId: "n", x: 1, y: 2 }]);
  assert.equal(presence.length, 0);
  f.session.suspend();
  f.session.publishCursor(null);
  assert.equal(cursors.length, 1);
});

test("historical context reads continue without publication and reject obsolete authority or lifecycle", async () => {
  const { createDocumentView } = await import(
    "../src/browser/document-view.ts"
  );
  const { createDocumentActivity } = await import("../src/browser/activity.ts");
  let allowed = true;
  let pending: ReturnType<typeof deferred<any>> | null = null;
  const calls: string[] = [];
  const gate = publicationGate();
  const session = createCollaborationSession({
    gate,
    readState: initial,
    updateState() {},
    authenticated: () => true,
    contextReadsAllowed: () => allowed,
  });
  const transport: SessionTransport = {
    async request(op) {
      calls.push(op.kind);
      return (
        pending ? pending.promise : { source: "old", snapshot: null }
      ) as any;
    },
    connect() {
      return { close() {}, send() {} };
    },
  };
  session.attach(transport);
  const activity = createDocumentActivity([session]);
  const view = createDocumentView({
    source: "live",
    revision: "r",
    snapshot: null,
    contexts: {
      cached: () => ({ snapshots: {} }),
      comment: (id) => session.readContext({ kind: "context.get", id }),
      viewer: (sessionId) =>
        session.readContext({ kind: "presence.capture", sessionId }),
    },
    surface: { mount() {}, suspend() {} },
    activity,
    changed() {},
  });
  await view.showComment({
    id: "first",
    sourceRevision: "old",
    appStateId: null,
  });
  assert.equal(gate.active, false);
  await view.showComment({
    id: "second",
    sourceRevision: "old",
    appStateId: null,
  });
  assert.deepEqual(calls, ["context.get", "context.get"]);
  await assert.rejects(
    session.request({ kind: "comments.resolve", id: "c", revision: 1 }),
  );
  await assert.rejects(
    (session.request as any)(
      { kind: "comments.resolve", id: "c", revision: 1 },
      true,
    ),
  );
  // Runtime checks also reject forged mutation operations despite the typed allowlist.
  await assert.rejects(
    session.readContext({
      kind: "comments.resolve",
      id: "c",
      revision: 1,
    } as any),
  );
  pending = deferred<any>();
  const stale = session.readContext({ kind: "context.get", id: "stale" });
  await Promise.resolve();
  session.attach(transport);
  await assert.rejects(stale);
  pending = deferred<any>();
  const preCache = session.readContext({
    kind: "context.get",
    id: "before-cache",
  });
  await Promise.resolve();
  activity.suspend("page-cache");
  activity.resume("page-cache");
  pending.resolve({ source: "obsolete", snapshot: null });
  await assert.rejects(preCache);
  assert.equal(
    gate.active,
    false,
    "returning from cache does not resume history publication",
  );
  pending = deferred<any>();
  const hidden = session.readContext({ kind: "context.get", id: "hidden" });
  await Promise.resolve();
  allowed = false;
  pending.resolve({ source: "old", snapshot: null });
  await assert.rejects(hidden);
  await assert.rejects(
    session.readContext({ kind: "context.get", id: "blocked" }),
  );
  allowed = true;
  session.dispose();
  await assert.rejects(
    session.readContext({ kind: "context.get", id: "disposed" }),
  );
  assert.deepEqual(calls, [
    "context.get",
    "context.get",
    "context.get",
    "context.get",
    "context.get",
  ]);
});

 test("authorized live changes and reconnect ready notify query refresh hooks; obsolete sockets do not", async () => {
 const f=fixture(); const live=f.live;
 live.ready(); await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.readyNotifications,1);
 live.changed(); assert.equal(f.invalidations,1);
 f.session.attach(f.transport);
 live.changed(); assert.equal(f.invalidations,1);
 f.live.ready(); await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.readyNotifications,2);
 f.live.status("error","Connection rejected"); assert.equal(f.invalidations,2);
 f.session.dispose(); f.live.changed(); assert.equal(f.invalidations,2);
 });
