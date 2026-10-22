import { test } from "node:test";
import assert from "node:assert/strict";
import { datasetMutationBoot } from "../src/migration/conversion/compiled/dataset-mutation-boot.ts";

test("compiled mutation boot forwards the authored row snapshot to the typed helper", async () => {
  const calls: unknown[][] = [];
  const answer = { committed: true };
  const adapter = {
    mutate: async (...args: unknown[]) => {
      calls.push(args);
      return answer;
    },
    subscribe: () => () => {},
    status: () => null,
  };
  const store: Record<string, any> = {};
  const element = () => ({
    setAttribute() {},
    append() {},
    replaceChildren() {},
  });
  const run = new Function(
    "store",
    "createCompiledDatasetMutations",
    "createSignal",
    "document",
    "window",
    "client",
    "gql",
    "values",
    "write",
    "declarations",
    "run",
    "compiledMutationIntentStore",
    datasetMutationBoot([], false),
  );
  run(
    store,
    () => adapter,
    () => [() => 0, () => {}],
    { createElement: element, body: element() },
    { addEventListener() {} },
    {},
    () => {},
    () => ({}),
    () => {},
    [],
    () => {},
    () => ({}),
  );
  const args = { note: "updated" };
  const row = Object.freeze({
    key: "row-a",
    count: 2,
    unused: "not an operation parameter",
  });
  assert.equal(await store.mutate("update", args, row), answer);
  assert.deepEqual(calls, [["update", args, row]]);
  assert.equal(calls[0]![2], row);
});
