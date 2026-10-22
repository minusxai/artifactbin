import test from "node:test";
import assert from "node:assert/strict";
import { createDatasetPersonService } from "../src/datasets/person.ts";
import type { DatasetPersonPorts } from "../src/datasets/person-contracts.ts";
const context = {
  backendId: "Back12",
  backendVersion: "v",
  pageId: "Page12",
  subject: "viewer",
};
const binding = {
  ...context,
  sourceNamespace: "legacy",
  pageVersion: 1,
  valueName: "selected",
  bindingName: "people",
  schema: "public",
  table: "rows",
  column: "who",
};
function fixture() {
  let cards = 0;
  const ports: DatasetPersonPorts = {
    binding: async () => binding,
    reads: {
      read: async () => ({
        version: 1,
        generation: 1,
        schema: "public",
        table: "rows",
        columns: [{ name: "who", type: "user" }],
        rows: [{ who: "original-user" }],
        offset: 0,
        nextOffset: null,
        totalRows: 1,
      }),
    },
    card: async () => {
      cards++;
      return { name: "Public name", handle: "handle", image: null };
    },
  };
  return { ports, cards: () => cards };
}
test("a registered bound selector names only a user in fresh policy-filtered rows", async () => {
  const f = fixture();
  assert.deepEqual(
    await createDatasetPersonService(f.ports).person(context, {
      valueName: "selected",
      userId: "original-user",
    }),
    { name: "Public name", handle: "handle", image: null },
  );
  assert.equal(f.cards(), 1);
  const unknown = fixture();
  assert.equal(
    await createDatasetPersonService(unknown.ports).person(context, {
      valueName: "selected",
      userId: "not-visible",
    }),
    null,
  );
  assert.equal(unknown.cards(), 0);
  for (const input of [
    { valueName: "selected", userId: "original-user", source: "other" },
    { valueName: "selected", userId: 1 },
  ])
    await assert.rejects(
      createDatasetPersonService(f.ports).person(context, input),
    );
});
test("revocation and changed dataset generation clear a selected person instead of retaining a card", async () => {
  const f = fixture();
  let reads = 0;
  const read = f.ports.reads.read;
  f.ports.reads.read = async (...args) => ({
    ...(await read(...args)),
    generation: ++reads,
  });
  await assert.rejects(
    createDatasetPersonService(f.ports).person(context, {
      valueName: "selected",
      userId: "original-user",
    }),
    /dataset_changed/,
  );
  const revoked = fixture();
  let bindings = 0;
  revoked.ports.binding = async () => (++bindings === 1 ? binding : null);
  await assert.rejects(
    createDatasetPersonService(revoked.ports).person(context, {
      valueName: "selected",
      userId: "original-user",
    }),
    /denied/,
  );
});

test("person lookup aborts a pending read and never performs subsequent work", async () => {
  const f = fixture(),
    abort = new AbortController();
  let calls = 0,
    received: AbortSignal | undefined;
  f.ports.reads.read = async (_context, _input, signal) => {
    calls++;
    received = signal;
    return await new Promise(() => {});
  };
  const pending = createDatasetPersonService(f.ports).person(
    context,
    { valueName: "selected", userId: "original-user" },
    abort.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  abort.abort();
  await assert.rejects(pending);
  assert.equal(received?.aborted, true);
  assert.equal(calls, 1);
  assert.equal(f.cards(), 0);
});
test("person scan capacity is finite and private profile keys and unsafe images cannot escape", async () => {
  const f = fixture();
  let calls = 0;
  const read = f.ports.reads.read;
  f.ports.reads.read = async (...args) => ({
    ...(await read(...args)),
    rows: [],
    nextOffset: ++calls,
    totalRows: 100000,
  });
  await assert.rejects(
    createDatasetPersonService(f.ports).person(context, {
      valueName: "selected",
      userId: "missing",
    }),
    /result_limit/,
  );
  assert.ok(calls <= 16);
  assert.equal(f.cards(), 0);
  for (const card of [
    { name: "N", handle: null, image: "javascript:alert(1)" },
    { name: "N", handle: null, image: null, email: "private" },
  ]) {
    const bad = fixture();
    bad.ports.card = async () => card;
    await assert.rejects(
      createDatasetPersonService(bad.ports).person(context, {
        valueName: "selected",
        userId: "original-user",
      }),
      /invalid_dataset/,
    );
  }
});
