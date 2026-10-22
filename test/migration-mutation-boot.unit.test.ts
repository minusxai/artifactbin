import test from "node:test";
import assert from "node:assert/strict";
import { createClient, gql } from "../src/apollo/client.ts";
import { persistentStore } from "../src/browser/core/standalone.ts";
import {
  createCompiledDatasetMutations,
  compiledMutationIntentStore,
} from "../src/migration/conversion/compiled/dataset-mutations.ts";
import {createCompiledMutationAvailability} from "../src/migration/conversion/compiled/mutation-availability.ts";
import { datasetMutationBoot } from "../src/migration/conversion/compiled/dataset-mutation-boot.ts";
test("generated boot immediately renders restored uncertainty and reconciles original ID after an explicit click", async () => {
  const disk = new Map<string, string>(),
    storage = {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => {
        disk.set(k, v);
      },
    };
  const local = () =>
    createClient({ backends: [], state: persistentStore({}, "page", storage) });
  const binding = {
    name: "save",
    recoveryScope: "a".repeat(64),
    backendNamespace: "data",
    paramTypes: { value: "number" as const },
  };
  const calls: any[] = [];
  const client = {
    ...local(),
    authorizationContext: () => "opaque-caller",
    mutate: async (input: any) => {
      calls.push(input);
      throw Error("lost");
    },
  };
  const initial = createCompiledDatasetMutations({
    bindings: [binding],
    client,
    documents: {
      data: gql`
        mutation {
          data {
            mutate
          }
        }
      `,
    },
    intentStore: compiledMutationIntentStore(
      client,
      gql`
        {
          datasetMutationIntents
        }
      `,
    ),
    authorizationContext: client.authorizationContext,
    requestId: () => "request-000000000-1",
    values: () => ({ value: 9 }),
    reset() {},
    committed() {},
  });
  await assert.rejects(initial.mutate("save"), /unknown/);
  const sent = calls[0].variables;
  const reloaded = {
    ...local(),
    authorizationContext: () => "opaque-caller",
    mutate: async (input: any) => {
      calls.push(input);
      return {
        data: {
          data: {
            mutate: { affected: 1, rowCount: 1, version: 2, generation: 2 },
          },
        },
        extensions: { outcomes: { "data.mutate": "committed" } },
      };
    },
  };
  const nodes: any[] = [];
  function element(tag: string) {
    const node: any = {
      tag,
      children: [],
      textContent: "",
      setAttribute() {},
      append(child: any) {
        this.children.push(child);
      },
      replaceChildren() {
        this.children = [];
      },
      addEventListener(_event: string, fn: () => void) {
        this.click = fn;
      },
    };
    nodes.push(node);
    return node;
  }
  const body = element("body");
  const doc = { body, createElement: element };
  new Function(
    "client",
    "gql",
    "createSignal",
    "createCompiledDatasetMutations",
    "createCompiledMutationAvailability",
    "compiledMutationIntentStore",
    "values",
    "write",
    "declarations",
    "run",
    "document",
    "window",
    "store",
    datasetMutationBoot([binding], false),
  )(
    reloaded,
    gql,
    (initial: number) => {
      let value = initial;
      return [
        () => value,
        (f: (n: number) => number) => {
          value = f(value);
        },
      ];
    },
    createCompiledDatasetMutations,
    createCompiledMutationAvailability,
    compiledMutationIntentStore,
    () => ({ value: 10 }),
    () => {},
    [],
    () => {},
    doc,
    { addEventListener() {} },
    {},
  );
  assert.equal(calls.length, 1);
  const button = nodes.find((n) => n.tag === "button");
  assert.ok(
    button,
    "restored record offers explicit reconciliation immediately",
  );
  button.click();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].variables, sent);
  assert.deepEqual(
    compiledMutationIntentStore(
      reloaded,
      gql`
        {
          datasetMutationIntents
        }
      `,
    ).read(),
    {},
  );
});
