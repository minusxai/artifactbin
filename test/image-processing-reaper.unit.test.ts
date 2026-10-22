import test from "node:test";
import assert from "node:assert/strict";
import { reapImageContainers } from "../src/media/image-processing/reaper.ts";
const id = "a".repeat(64),
  name = "/demo-image-11111111-1111-1111-1111-111111111111";
test("startup cleanup only removes dedicated processor names and exact labels", async () => {
  const calls: readonly string[][] = [];
  let listed = 0;
  await reapImageContainers(async (args) => {
    (calls as string[][]).push([...args]);
    if (args[0] === "ps") return listed++ === 0 ? id : "";
    if (args[0] === "inspect")
      return JSON.stringify([
        {
          Id: id,
          Name: name,
          Config: { Labels: { "demo.image-processor": "1" } },
        },
      ]);
    return "";
  }, "demo");
  assert.deepEqual(calls[0], [
    "ps",
    "-aq",
    "--filter",
    "label=demo.image-processor=1",
  ]);
  assert.ok(calls.some((c) => c[0] === "rm" && c[2] === id));
});
test("startup cleanup refuses foreign backend container even with matching image label", async () => {
  let removed = false;
  await assert.rejects(
    reapImageContainers(async (args) => {
      if (args[0] === "ps") return id;
      if (args[0] === "inspect")
        return JSON.stringify([
          {
            Id: id,
            Name: name.replace("-image-", "-backend-"),
            Config: { Labels: { "demo.image-processor": "1" } },
          },
        ]);
      removed = true;
      return "";
    }, "demo"),
    /image_cleanup_failed/,
  );
  assert.equal(removed, false);
});
test("late foreign inventory and duplicate full IDs refuse all removals", async () => {
  for (const duplicate of [false, true]) {
    let removed = 0;
    const other = "b".repeat(64);
    await assert.rejects(
      reapImageContainers(async (args) => {
        if (args[0] === "ps")
          return duplicate ? id + "\n" + id.slice(0, 12) : id + "\n" + other;
        if (args[0] === "inspect")
          return JSON.stringify([
            {
              Id: duplicate ? id : args[1],
              Name: !duplicate && args[1] === other ? "/foreign" : name,
              Config: { Labels: { "demo.image-processor": "1" } },
            },
          ]);
        removed++;
        return "";
      }, "demo"),
      /image_cleanup_failed/,
    );
    assert.equal(removed, 0);
  }
});
