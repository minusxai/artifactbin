import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformStatus } from "../src/browser/platform-status.ts";
import type { PlatformStatusInput } from "../src/browser/platform-status-contracts.ts";
function fixture() {
  let state: PlatformStatusInput = {
    hosted: false,
    preview: true,
    remote: true,
    historical: false,
    fileDirty: false,
    pendingComments: 0,
    drafts: {},
    sync: "synced",
  };
  const errors: unknown[] = [];
  const labels: string[] = [];
  const status = createPlatformStatus({
    read: () => state,
    render: (l) => labels.push(l),
    onObserverError: (e) => errors.push(e),
  });
  return { state, status, errors, labels };
}
test("history and explicit notices override normal status; standalone dirtiness and drafts remain visible", () => {
  const f = fixture();
  f.state.historical = true;
  assert.match(f.status.label(), /Saved view/);
  assert.equal(f.status.label("failure"), "failure");
  f.state.historical = false;
  f.state.preview = false;
  f.state.remote = false;
  f.state.fileDirty = true;
  assert.match(f.status.label(), /Unsaved local changes/);
  assert.equal(f.status.read().mode, "file");
  assert.equal(f.status.read().dirty, true);
  f.state.fileDirty = false;
  f.state.drafts = { a: "unsent" };
  assert.equal(f.status.read().dirty, true);
});
test("observer failure and unsubscription cannot interrupt other status delivery", () => {
  const f = fixture();
  let calls = 0;
  f.status.subscribe(() => {
    throw Error("observer");
  });
  const off = f.status.subscribe(() => calls++);
  f.status.publish();
  assert.equal(calls, 1);
  assert.equal(f.errors.length, 1);
  assert.equal(f.labels.length, 1);
  off();
  f.status.publish();
  assert.equal(calls, 1);
});

test("action errors survive presence and sync publications until another user action", () => {
  const f = fixture();
  const observed: string[] = [];
  f.status.subscribe((state) => observed.push(state.sync));
  f.status.notice("This viewer is not sharing their view");
  f.status.publish("");
  f.state.sync = "disconnected";
  f.status.publish("Connecting for live updates…");
  assert.deepEqual(
    f.labels,
    Array(3).fill("This viewer is not sharing their view"),
  );
  assert.equal(
    f.status.read().sync,
    "disconnected",
    "background state still reaches observers",
  );
  assert.equal(observed.at(-1), "disconnected");
  f.status.clearNotice();
  assert.doesNotMatch(f.labels.at(-1)!, /not sharing/);
  f.status.publish("Connected again");
  assert.equal(f.labels.at(-1), "Connected again");
});

test("retained action notices cannot hide a connection error", () => {
  const f = fixture();
  f.status.notice("This viewer is not sharing their view");
  f.state.sync = "error";
  f.status.publish("Connection failed");
  assert.match(f.labels.at(-1)!, /Connection failed.*not sharing/);
});

test("notice callbacks do not depend on their receiver", () => {
  const f = fixture();
  const { notice, clearNotice, publish } = f.status;
  notice("Action failed");
  publish();
  assert.equal(f.labels.at(-1), "Action failed");
  clearNotice();
  assert.doesNotMatch(f.labels.at(-1)!, /Action failed/);
});

test("a hosted page shows the live session's own message, not a bare sync state, while it connects", () => {
  const f = fixture();
  f.state.preview = false;
  f.state.hosted = true;
  f.state.sync = "disconnected";
  f.state.sessionMessage = "Connecting for live updates…";
  // A background publication (a view report) carries no message of its own.
  f.status.publish();
  assert.equal(f.labels.at(-1), "Connecting for live updates…");
  assert.doesNotMatch(f.labels.at(-1)!, /disconnected/);
  f.state.sessionMessage = "";
  f.state.sync = "syncing";
  f.status.publish();
  assert.equal(f.labels.at(-1), "Comments sync automatically · syncing");
  // An explicit message still wins over the session's.
  f.state.sessionMessage = "A newer version of this page exists. Reload to see it.";
  f.status.publish("Choose something to comment on, or right-click it.");
  assert.equal(f.labels.at(-1), "Choose something to comment on, or right-click it.");
  f.status.publish();
  assert.equal(f.labels.at(-1), "A newer version of this page exists. Reload to see it.");
});
