import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { localBootSource } from "../src/migration/conversion/compiled/local-boot.ts";
import type { CompleteControlOptions } from "../src/migration/conversion/compiled/control-options-contracts.ts";
test("generated boot embeds a standalone compatible pagination function with deadline cleanup", async () => {
  const boot = localBootSource([]);
  const start = boot.indexOf("const completeControlOptions=");
  const end = boot.indexOf("\nconst controlPageRequest=", start);
  assert.ok(start >= 0 && end > start);
  const complete = runInNewContext(
    boot.slice(start, end) + ";completeControlOptions",
    { AbortController, TextEncoder },
  ) as CompleteControlOptions;
  const initial = {
    columns: [{ name: "n", type: "number" }],
    rows: [{ n: 1 }],
    totalRows: 2,
  };
  let disposed = 0;
  const answer = await complete(
    initial,
    async (offset) => {
      assert.equal(offset, 1);
      return { ...initial, rows: [{ n: 2 }] };
    },
    {},
    {
      now: () => 0,
      schedule: () => () => {
        disposed++;
      },
    },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(answer.rows)), [
    { n: 1 },
    { n: 2 },
  ]);
  assert.equal(disposed, 1);
  let timeout!: () => void;
  const pending = complete(
    initial,
    () => new Promise(() => {}),
    {},
    {
      now: () => 0,
      schedule: (callback) => {
        timeout = callback;
        return () => {
          disposed++;
        };
      },
    },
  );
  const rejected = assert.rejects(pending, /timed out/);
  timeout();
  await rejected;
  assert.equal(disposed, 2);
});
