import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocumentView } from "../src/browser/document-view.ts";
import type { Snapshot, DocumentState } from "../src/contracts.ts";
const snap = (count: number, revision = "live"): Snapshot => ({
  schema: 1,
  sourceRevision: revision,
  state: { count },
  view: { x: 0, y: 0 },
});
function fixture() {
  const mounts: any[] = [];
  const events: any[] = [];
  let comment: (id: string) => Promise<any> = async () => ({
    source: "old source",
    snapshot: snap(1, "old"),
  });
  const view = createDocumentView({
    source: "live source",
    revision: "live",
    snapshot: snap(5),
    contexts: {
      cached: () => ({ sources: {}, snapshots: {} }),
      comment: (id) => comment(id),
      viewer: (id) => comment(id),
    },
    surface: {
      mount: (...args) => mounts.push(args),
      suspend: () => events.push("suspend-app"),
    },
    activity: {
      suspend: (r) => events.push("suspend:" + r),
      resume: (r) => events.push("resume:" + r),
    },
    changed: (c) => events.push(c),
  });
  return {
    view,
    mounts,
    events,
    set comment(fn: (id: string) => Promise<any>) {
      comment = fn;
    },
  };
}
test("history preserves the latest live snapshot for exports and restores it exactly once", async () => {
  const f = fixture();
  f.view.receiveView({ snapshot: snap(7), targets: [] });
  await f.view.showComment({
    id: "c",
    appStateId: "snapshot",
    sourceRevision: "old",
  });
  assert.equal(f.view.snapshot?.state.count, 1);
  const metadata = {
    app: null,
    remote: null,
    comments: [],
  } as unknown as DocumentState;
  assert.equal(f.view.envelope(metadata).app?.state.count, 7);
  assert.equal(f.view.historical, true);
  assert.equal(f.view.returnLive(), true);
  assert.equal(f.view.snapshot?.state.count, 7);
  assert.equal(f.view.returnLive(), false);
  assert.equal(f.mounts.at(-1)[0], "live source");
});
test("newer selection or return supersedes late context results and errors", async () => {
  const f = fixture();
  const waiting = new Map<string, (value: any) => void>();
  f.comment = (id) => new Promise((resolve) => waiting.set(id, resolve));
  const first = f.view.showComment({
    id: "first",
    appStateId: "a",
    sourceRevision: "old",
  });
  const second = f.view.showComment({
    id: "second",
    appStateId: "b",
    sourceRevision: "old",
  });
  waiting.get("second")!({ source: "second", snapshot: snap(2, "old") });
  await second;
  waiting.get("first")!({ source: "first", snapshot: snap(1, "old") });
  await first;
  assert.equal(f.view.snapshot?.state.count, 2);
  const third = f.view.showViewer("third");
  f.view.returnLive();
  waiting.get("third")!({ source: "third", snapshot: snap(3, "old") });
  await third;
  assert.equal(f.view.historical, false);
  assert.equal(f.view.snapshot?.state.count, 5);
});
test("stale and malformed app reports cannot change snapshot or targets", () => {
  const f = fixture();
  assert.equal(
    f.view.receiveView({ snapshot: snap(8, "wrong"), targets: [] }),
    false,
  );
  assert.equal(f.view.snapshot?.state.count, 5);
  assert.throws(() =>
    f.view.receiveView({
      snapshot: snap(8),
      targets: [
        {
          id: "a",
          quote: "",
          rect: { x: Infinity, y: 0, width: 0, height: 0 },
        },
      ],
    }),
  );
  assert.equal(f.view.snapshot?.state.count, 5);
  assert.deepEqual(f.view.targets, []);
});

test("multiple historical selections keep the original live boundary and ignore hidden-app reports", async () => {
  const f = fixture();
  await f.view.showComment({
    id: "first",
    appStateId: "a",
    sourceRevision: "old",
  });
  f.comment = async () => ({ source: "other", snapshot: snap(2, "other") });
  await f.view.showComment({
    id: "second",
    appStateId: "b",
    sourceRevision: "other",
  });
  assert.equal(f.view.revision, "other");
  assert.equal(f.view.receiveView({ snapshot: snap(99), targets: [] }), false);
  f.view.returnLive();
  assert.equal(f.view.revision, "live");
  assert.equal(f.view.snapshot?.state.count, 5);
});
test("a comment without a cached view asks the server, falls back to its cached source, and preserves a null live snapshot", async () => {
  let fetched = 0;
  const mounts: any[] = [];
  const view = createDocumentView({
    source: "live",
    revision: "live",
    snapshot: null,
    contexts: {
      cached: () => ({ sources: { old: "cached old" }, snapshots: {} }),
      comment: async () => {
        fetched++;
        throw Error("unused");
      },
      viewer: async () => {
        throw Error("unused");
      },
    },
    surface: { mount: (...args) => mounts.push(args), suspend() {} },
    activity: { suspend() {}, resume() {} },
    changed() {},
  });
  await view.showComment({ id: "c", appStateId: null, sourceRevision: "old" });
  assert.equal(fetched, 1);
  assert.equal(mounts[0][0], "cached old");
  assert.equal(view.returnLive(), true);
  assert.equal(view.snapshot, null);
});
test("saved-context mode remains inert and cannot return to executable source", async () => {
  const events: string[] = [];
  const view = createDocumentView({
    source: "saved",
    revision: "old",
    snapshot: snap(1, "old"),
    contextOnly: true,
    contexts: {
      cached: () => ({ snapshots: {} }),
      comment: async () => {
        throw Error("unused");
      },
      viewer: async () => {
        throw Error("unused");
      },
    },
    surface: {
      mount: (_source, _snapshot, _revision, history) =>
        events.push("mount:" + history),
      suspend: () => events.push("app-suspend"),
    },
    activity: {
      suspend: (r) => events.push(r),
      resume: () => events.push("resume"),
    },
    changed: () => {},
  });
  view.start();
  view.start();
  assert.equal(view.historical, true);
  assert.equal(view.returnLive(), false);
  assert.equal(view.receiveView({ snapshot: snap(9, "old") }), false);
  await view.showViewer("someone");
  assert.deepEqual(events, ["saved-context", "app-suspend", "mount:true"]);
});
test("returned target arrays cannot mutate geometry and disposal invalidates pending context", async () => {
  const f = fixture();
  const target = {
    id: "one",
    quote: "text",
    rect: { x: 1, y: 2, width: 3, height: 4 },
  };
  f.view.receiveView({ snapshot: snap(5), targets: [target] });
  target.rect.x = 99;
  const result = f.view.targets;
  result.length = 0;
  assert.equal(f.view.targets[0]!.rect.x, 1);
  let reject!: (error: Error) => void;
  f.comment = () => new Promise((_resolve, fail) => (reject = fail));
  const pending = f.view.showViewer("remote");
  f.view.dispose();
  reject(Error("late"));
  await pending;
  assert.equal(f.mounts.length, 0);
  assert.equal(f.view.receiveView({ snapshot: snap(10) }), false);
});
test("mismatched fetched source revision rejects before suspending the live view", async () => {
  const f = fixture();
  f.comment = async () => ({ source: "wrong", snapshot: snap(1, "other") });
  await assert.rejects(
    f.view.showComment({ id: "c", appStateId: "a", sourceRevision: "old" }),
    /another source/,
  );
  assert.equal(f.view.historical, false);
  assert.equal(f.events.length, 0);
  assert.equal(f.view.snapshot?.state.count, 5);
});

test("malformed app state reports preserve the last valid export and remain recoverable", () => {
  const malformed: unknown[] = [
    { ...snap(8), schema: -1 },
    { ...snap(8), state: [] },
    { ...snap(8), view: { x: 0, y: Infinity } },
    { ...snap(8), rendered: 42 },
    { ...snap(8), state: { note: undefined } },
  ];
  for (const snapshot of malformed) {
    const f = fixture();
    assert.throws(() => f.view.receiveView({ snapshot }));
    assert.equal(f.view.snapshot?.state.count, 5);
    assert.equal(f.view.historical, false);
    assert.equal(f.events.length, 0);
    assert.equal(f.view.receiveView({ snapshot: snap(9) }), true);
    assert.equal(f.view.snapshot?.state.count, 9);
  }
});

test("unavailable original context never fetches, mounts or replays the current page", async () => {
  const f = fixture();
  f.comment = async () => { throw Error("must not fetch unavailable history"); };
  await assert.rejects(f.view.showComment({ id: "legacy", appStateId: null, sourceRevision: null,
    context: { status: "unavailable", originalRevision: "17", reason: "not-retained" },
  }), /Original context unavailable/);
  assert.equal(f.mounts.length, 0);
  assert.equal(f.view.historical, false);
  assert.equal(f.view.revision, "live");
});

test("an aborted comment context cannot replay its cached-source fallback after fetch failure",async()=>{
 const f=fixture();let reject!:(error:Error)=>void;
 f.comment=()=>new Promise((_resolve,fail)=>reject=fail);
 const controller=new AbortController();
 const pending=f.view.showComment({id:"comment",sourceRevision:"live",appStateId:null},controller.signal);
 controller.abort();reject(Error("late failure"));await pending;
 assert.equal(f.view.historical,false);assert.deepEqual(f.mounts,[]);
});
