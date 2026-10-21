import test from "node:test";
import assert from "node:assert/strict";
import { createHostedStartup } from "../src/browser/hosted-startup.js";

test("startup waits for the app, reports stalls, and recovers after a slow load", () => {
  let timeout = () => {};
  const changes: string[] = [];
  const startup = createHostedStartup((state) => changes.push(state), {
    setTimeout(callback, delay) {
      assert.equal(delay, 30000);
      timeout = callback;
      return 1;
    },
    clearTimeout() {},
  });
  assert.deepEqual(changes, ["loading"]);
  timeout();
  assert.deepEqual(changes, ["loading", "failed"]);
  startup.ready();
  startup.fail();
  assert.deepEqual(changes, ["loading", "failed", "ready"]);
});

test("startup completion cancels its deadline and ignores late failure", () => {
  const changes: string[] = [];
  let cleared = false;
  const startup = createHostedStartup((state) => changes.push(state), {
    setTimeout() {
      return 42;
    },
    clearTimeout(timer) {
      assert.equal(timer, 42);
      cleared = true;
    },
  });
  startup.ready();
  startup.fail();
  assert.equal(cleared, true);
  assert.deepEqual(changes, ["loading", "ready"]);
});
