import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompiledReadiness } from "../src/migration/conversion/compiled/readiness.ts";
test("compiled widgets start on the next task after hydration and cancelled widgets stay stopped", () => {
  const tasks = new Set<() => void>();
  const clock = {
    schedule(fn: () => void) {
      tasks.add(fn);
      return () => tasks.delete(fn);
    },
  };
  const readiness = createCompiledReadiness(clock);
  let calls = 0;
  const cancel = readiness.defer(() => calls++);
  cancel();
  readiness.defer(() => calls++);
  assert.equal(tasks.size, 0);
  readiness.ready();
  readiness.ready();
  assert.equal(calls, 0);
  assert.equal(tasks.size, 1);
  for (const fn of tasks) fn();
  tasks.clear();
  assert.equal(calls, 1);
  const stop = readiness.defer(() => calls++);
  assert.equal(tasks.size, 1);
  stop();
  for (const fn of tasks) fn();
  assert.equal(calls, 1);
});
