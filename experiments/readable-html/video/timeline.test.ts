import test from "node:test";
import assert from "node:assert/strict";
import { frameState, validateSpec } from "./timeline.ts";
const spec = { width: 960, height: 540, fps: 24, frameCount: 384 };
test("frame boundaries and scene transitions have explicit state", () => {
  assert.equal(frameState(spec, 0).progress, 0);
  assert.equal(frameState(spec, 383).progress, 1);
  assert.equal(frameState(spec, 95).scene, "morning");
  assert.equal(frameState(spec, 96).scene, "imbalance");
  assert.equal(frameState(spec, 192).scene, "rebalance");
  assert.equal(frameState(spec, 288).scene, "outcome");
  assert.equal(frameState(spec, 383).sceneProgress, 1);
  assert.equal(frameState(spec, 96).seconds, 4);
});
test("seeking backwards and repeated calls are independent of history", () => {
  const before = frameState(spec, 32);
  frameState(spec, 383);
  frameState(spec, 0);
  assert.deepEqual(frameState(spec, 32), before);
});
test("invalid timing, dimensions and frames are rejected", () => {
  for (const key of ["width", "height", "fps", "frameCount"]) {
    for (const value of [0, -1, NaN, Infinity, 1.5]) {
      assert.throws(() => validateSpec({ ...spec, [key]: value }));
    }
  }
  for (const frame of [-1, 384, NaN, Infinity, 1.5]) assert.throws(() => frameState(spec, frame));
});
test("single frame compositions are supported", () => {
  assert.equal(frameState({ ...spec, frameCount: 1 }, 0).progress, 0);
});
