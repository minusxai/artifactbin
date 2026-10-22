import test from "node:test";
import assert from "node:assert/strict";
import { runMigrationBoundedWork } from "../src/migration/bounded-work.ts";
test("offline preparation refills completed slots while long history remains pending and never exceeds bound", async () => {
  let releaseLong!: () => void;
  const long = new Promise<void>((resolve) => (releaseLong = resolve));
  let releaseNext!: () => void;
  const next = new Promise<void>((resolve) => (releaseNext = resolve));
  let active = 0,
    peak = 0;
  const started: number[] = [];
  const run = runMigrationBoundedWork([0, 1, 2, 3, 4], 2, async (item) => {
    active++;
    peak = Math.max(peak, active);
    started.push(item);
    if (item === 0) await long;
    if (item === 2) {
      releaseNext();
    }
    active--;
  });
  const advanced = await Promise.race([
    next.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 30)),
  ]);
  releaseLong();
  await run;
  assert.equal(advanced, true);
  assert.equal(peak, 2);
  assert.deepEqual([...started].sort(), [0, 1, 2, 3, 4]);
});
test("a failed artifact stops new work and drains in-flight work before rejecting", async () => {
  const failure = Error("fixture failure");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  const started: number[] = [];
  let completed = false;
  const result = runMigrationBoundedWork([0, 1, 2], 2, async (item) => {
    started.push(item);
    if (item === 0) throw failure;
    await pending;
    completed = true;
  }).then(
    () => null,
    (error) => error,
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started, [0, 1]);
  assert.equal(completed, false);
  release();
  assert.equal(await result, failure);
  assert.equal(completed, true);
  assert.deepEqual(started, [0, 1]);
});
