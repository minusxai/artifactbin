import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "graphql";
import { createClient, gql } from "../src/apollo/client.ts";
import { persistentStore } from "../src/browser/core/standalone.ts";
import {
  compiledMutationIntentStore,
  createCompiledDatasetMutations,
} from "../src/migration/conversion/compiled/dataset-mutations.ts";
import type { CompiledDatasetMutation } from "../src/migration/conversion/compiled/dataset-mutations-contracts.ts";
import type { CompiledMutationIntent } from "../src/migration/conversion/compiled/dataset-mutations-contracts.ts";
for (const capacity of ["count", "aggregate"] as const)
  test(`proposed ${capacity} overflow cannot persist or dispatch and preserves all recoverable intents`, async () => {
    const saved: Record<string, CompiledMutationIntent> = {};
    const count = capacity === "count" ? 64 : 8;
    for (let i = 0; i < count; i++)
      saved["old" + i] = {
        version: 1,
        scope: "a".repeat(64),
        authorizationContext: "caller",
        name: "old" + i,
        requestId: "old-request-00000-" + i,
        params: capacity === "aggregate" ? { text: "x".repeat(16000) } : {},
        resetValues: {},
      };
    const original = JSON.stringify({ datasetMutationIntents: saved });
    const disk = new Map([["page", original]]);
    let diskWrites = 0,
      requests = 0;
    const storage = {
      getItem: (key: string) => disk.get(key) ?? null,
      setItem: (key: string, value: string) => {
        diskWrites++;
        disk.set(key, value);
      },
    };
    const state = persistentStore({}, "page", storage);
    const client = createClient({ state, backends: [] });
    const query = gql`
      {
        datasetMutationIntents
      }
    `;
    const paramTypes: CompiledDatasetMutation["paramTypes"] = capacity === "aggregate" ? { text: "string" } : {};
    const options = {
      bindings: [
        {
          name: "save",
          backendNamespace: "data",
          recoveryScope: "b".repeat(64),
          paramTypes,
        },
      ],
      documents: { data: parse("mutation{data{mutate}}") },
      client: {
        mutate: async () => {
          requests++;
          throw Error("lost");
        },
      },
      requestId: () => "new-request-0000000",
      values: () => ({ text: "y".repeat(16000) }),
      reset() {},
      committed() {},
      authorizationContext: () => "caller",
      intentStore: compiledMutationIntentStore(client, query),
    };
    const adapter = createCompiledDatasetMutations(options);
    await assert.rejects(adapter.mutate("save"));
    assert.equal(requests, 0);
    assert.equal(diskWrites, 0);
    assert.equal(disk.get("page"), original);
    const recovered = persistentStore({}, "page", storage);
    const restored = createCompiledDatasetMutations({
      ...options,
      intentStore: compiledMutationIntentStore(
        createClient({ state: recovered, backends: [] }),
        query,
      ),
    });
    assert.equal(restored.status("save"), null);
    const old = createCompiledDatasetMutations({
      ...options,
      bindings: [
        {
          name: "old0",
          backendNamespace: "data",
          recoveryScope: "a".repeat(64),
          paramTypes,
        },
      ],
      intentStore: compiledMutationIntentStore(
        createClient({ state: recovered, backends: [] }),
        query,
      ),
    });
    assert.equal(old.status("old0")?.state, "unknown");
    assert.equal(old.status("old0")?.requestId, saved.old0!.requestId);
    assert.equal(
      Object.keys(recovered.read().datasetMutationIntents!).length,
      count,
    );
    client.dispose();
  });
