import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompiledMutationAvailability } from "../../../src/migration/conversion/compiled/mutation-availability.ts";
test("cell availability is failclosed while loading, denied or errored and resumes only on fresh authorization", () => {
  let receive!: (value: unknown) => void;
  let changes = 0;
  const availability = createCompiledMutationAvailability({
    bindings: [{ name: "save", backendNamespace: "data" }],
    watch(_binding, next) {
      receive = next;
      return () => {};
    },
    changed() {
      changes++;
    },
  });
  assert.notEqual(availability.unavailable("save"), null);
  receive({ canAttempt: true });
  assert.equal(availability.unavailable("save"), null);
  for (const value of [
    undefined,
    { canAttempt: false },
    { canAttempt: "true" },
    { errors: ["denied"] },
    null,
  ]) {
    receive(value);
    assert.notEqual(availability.unavailable("save"), null);
  }
  receive({ canAttempt: true });
  assert.equal(availability.unavailable("save"), null);
  assert.notEqual(availability.unavailable("other"), null);
  assert.ok(changes > 0);
  availability.dispose();
});
test("late authorized receipts never restore permission after reconnect or dispose", () => {
  const receivers: Array<(value: unknown) => void> = [];
  let stops = 0;
  const availability = createCompiledMutationAvailability({
    bindings: [{ name: "save", backendNamespace: "data" }],
    watch(_binding, next) {
      receivers.push(next);
      return () => {
        stops++;
      };
    },
    changed() {},
  });
  receivers[0]!({ canAttempt: true });
  availability.reconnect();
  assert.notEqual(availability.unavailable("save"), null);
  receivers[0]!({ canAttempt: true });
  assert.notEqual(availability.unavailable("save"), null);
  receivers[1]!({ canAttempt: false });
  receivers[0]!({ canAttempt: true });
  assert.notEqual(availability.unavailable("save"), null);
  receivers[1]!({ canAttempt: true });
  assert.equal(availability.unavailable("save"), null);
  availability.dispose();
  receivers[1]!({ canAttempt: true });
  assert.notEqual(availability.unavailable("save"), null);
  assert.equal(stops, 2);
});
test("fixed generated availability query forwards only the registered operation to the captured dataset capability", async () => {
  const { generatedDatasetBackendSource } = await import(
    "../../../src/migration/datasets/import-metadata.ts"
  );
  const generated = await import(
    "data:text/javascript;base64," +
      Buffer.from(generatedDatasetBackendSource).toString("base64")
  );
  const calls: unknown[] = [];
  const result = await generated.default.Query.mutationAvailability(
    { operation: "save" },
    null,
    {
      dataset: {
        mutationAvailability: async (args: unknown) => {
          calls.push(args);
          return { canAttempt: false };
        },
      },
    },
  );
  assert.deepEqual(result, { canAttempt: false });
  assert.deepEqual(calls, [{ operation: "save" }]);
});
test("generated cell boot checks fresh advisory receipts without probing or losing the authored value and row", async () => {
  const { datasetMutationBoot } = await import(
    "../../../src/migration/conversion/compiled/dataset-mutation-boot.ts"
  );
  let receive!: (value: any) => void;
  let stopped = false;
  const calls: unknown[][] = [];
  const store: Record<string, any> = {};
  const element = () => ({
    setAttribute() {},
    append() {},
    replaceChildren() {},
  });
  const run = new Function(
    "store",
    "createCompiledDatasetMutations",
    "createCompiledMutationAvailability",
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
    datasetMutationBoot(
      [
        {
          name: "save",
          backendNamespace: "legacyData",
          recoveryScope: "a".repeat(64),
          paramTypes: {},
          valueParam: { param: "cell__value", type: "string" },
        },
      ],
      false,
    ),
  );
  run(
    store,
    () => ({
      mutate: async (...args: unknown[]) => {
        calls.push(args);
        return {};
      },
      subscribe: () => () => {},
      status: () => null,
    }),
    createCompiledMutationAvailability,
    () => [() => 0, () => {}],
    { createElement: element, body: element() },
    { addEventListener() {} },
    {
      watchQuery(options: any) {
        assert.equal(options.clearOnRefresh, true);
        assert.deepEqual(options.variables, { operation: "save" });
        return {
          subscribe(next: any) {
            receive = next;
            return {
              unsubscribe() {
                stopped = true;
              },
            };
          },
        };
      },
    },
    () => {},
    () => ({}),
    () => {},
    [],
    () => {},
    () => ({}),
  );
  const value = { _value: "Draft" },
    row = { id: "row-a" };
  await assert.rejects(store.mutate("save", value, row));
  assert.equal(calls.length, 0);
  receive({
    data: { legacyData: { mutationAvailability: { canAttempt: true } } },
  });
  await store.mutate("save", value, row);
  assert.deepEqual(calls, [["save", value, row]]);
  receive({ errors: [{ message: "denied" }] });
  await assert.rejects(store.mutate("save", value, row));
  assert.equal(calls.length, 1);
  assert.equal(stopped, false);
  assert.deepEqual(value, { _value: "Draft" });
  receive({
    data: { legacyData: { mutationAvailability: { canAttempt: true } } },
  });
  await store.mutate("save", value, row);
  assert.equal(calls.length, 2);
});
test("one throwing subscription cleanup never prevents other releases or failclosed reconnect", () => {
  const released: string[] = [];
  let attaches = 0;
  const availability = createCompiledMutationAvailability({
    bindings: [
      { name: "one", backendNamespace: "data" },
      { name: "two", backendNamespace: "data" },
    ],
    watch(binding, next) {
      attaches++;
      next({ canAttempt: true });
      return () => {
        released.push(binding.name);
        if (binding.name === "one") throw Error("release failed");
      };
    },
    changed() {},
  });
  availability.reconnect();
  assert.deepEqual(released, ["one", "two"]);
  assert.equal(attaches, 4);
  assert.equal(availability.unavailable("two"), null);
  availability.dispose();
  assert.deepEqual(released, ["one", "two", "one", "two"]);
  assert.notEqual(availability.unavailable("two"), null);
});
