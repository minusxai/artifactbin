import test from "node:test";
import assert from "node:assert/strict";
import {
  createDocumentActivity,
  settleActivityCallbacks,
} from "../src/browser/activity.ts";

test("history stays suspended through page-cache restoration; only final reason resumes", () => {
  const events: string[] = [];
  const activity = createDocumentActivity([
    {
      suspend: () => events.push("suspend"),
      resume: () => events.push("resume"),
      dispose: () => events.push("dispose"),
    },
  ]);
  activity.resume("page-cache");
  activity.suspend("history");
  activity.suspend("history");
  activity.suspend("page-cache");
  activity.resume("page-cache");
  assert.equal(activity.active, false);
  assert.deepEqual(events, ["suspend"]);
  activity.resume("history");
  assert.equal(activity.active, true);
  assert.deepEqual(events, ["suspend", "resume"]);
});

test("permanent disposal releases every participant once and cannot be resumed", () => {
  const events: string[] = [];
  const activity = createDocumentActivity(
    [0, 1].map((i) => ({
      suspend: () => events.push(`suspend${i}`),
      resume: () => events.push(`resume${i}`),
      dispose: () => events.push(`dispose${i}`),
    })),
  );
  activity.suspend("saved-context");
  activity.dispose();
  activity.dispose();
  activity.resume("saved-context");
  activity.suspend("history");
  assert.equal(activity.active, false);
  assert.deepEqual(events, ["suspend0", "suspend1", "dispose0", "dispose1"]);
});

test("one failing participant cannot prevent other resources from being released", () => {
  const events: string[] = [];
  const activity = createDocumentActivity([
    {
      suspend() {},
      resume() {},
      dispose() {
        throw Error("broken cleanup");
      },
    },
    {
      suspend() {},
      resume() {},
      dispose() {
        events.push("released");
      },
    },
  ]);
  assert.throws(() => activity.dispose(), AggregateError);
  assert.deepEqual(events, ["released"]);
  assert.equal(activity.active, false);
  activity.dispose();
});

test("partial resume failure returns all participants to suspended state", () => {
  const events: string[] = [];
  let fail = true;
  const activity = createDocumentActivity([
    {
      suspend() {
        events.push("stop");
      },
      resume() {
        events.push("start");
      },
      dispose() {},
    },
    {
      suspend() {},
      resume() {
        if (fail) throw Error("cannot start");
      },
      dispose() {},
    },
  ]);
  activity.suspend("history");
  assert.throws(() => activity.resume("history"), AggregateError);
  assert.equal(activity.active, false);
  assert.deepEqual(events, ["stop", "start", "stop"]);
  fail = false;
  activity.resume("history");
  assert.equal(activity.active, true);
});

test("aggregate participant releases every owned resource after multiple disposal failures", () => {
  const live = new Set([
    "backend",
    "view",
    "shared",
    "comments",
    "chrome",
    "connection",
    "presence",
  ]);
  const failures = [new Error("backend cleanup"), new Error("comment cleanup")];
  const activity = createDocumentActivity([
    {
      suspend() {},
      resume() {},
      dispose() {
        settleActivityCallbacks(
          [...live].map((resource) => () => {
            live.delete(resource);
            if (resource === "backend") throw failures[0];
            if (resource === "comments") throw failures[1];
          }),
          "dispose",
        );
      },
    },
  ]);
  assert.throws(
    () => activity.dispose(),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.ok(error.errors[0] instanceof AggregateError);
      assert.deepEqual(error.errors[0].errors, failures);
      return true;
    },
  );
  assert.equal(live.size, 0);
  assert.equal(activity.active, false);
  assert.doesNotThrow(() => activity.dispose());
});
