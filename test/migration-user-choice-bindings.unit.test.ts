import test from "node:test";
import assert from "node:assert/strict";
import { projectMigrationUserChoiceBindings } from "../src/migration/user-choice-bindings.ts";
import type { DatasetBinding } from "../src/datasets/contracts.ts";
import type { LegacyMutationDescriptor } from "../src/migration/conversion/mutation-contracts.ts";
const binding: DatasetBinding = {
  mode: "live",
  name: "data",
  backendId: "Back01",
  backendVersion: "v1",
  page: { id: "Page01", legacyId: "old-page", version: 1, editId: "edit" },
  dataset: { id: "dataset", version: 1, policyRevision: 0 },
  tables: [
    {
      schema: "public",
      name: "rows",
      columns: [{ name: "owner", type: "user" }],
      object: { key: "a".repeat(64), sha256: "a".repeat(64), bytes: 2 },
    },
  ],
};
const proof = {
  name: "items",
  column: "assigned",
  bindingName: "data",
  schema: "public",
  table: "rows",
  sourceColumn: "owner",
};
const mutation = { cellUserChoice: proof } as LegacyMutationDescriptor;
test("publication maps exact typed origin to immutable backend and version authority", () => {
  const projected = projectMigrationUserChoiceBindings(
    "legacy",
    [{ version: 1, mutations: [mutation, mutation] }],
    [binding],
  );
  assert.deepEqual(projected, [
    {
      ...proof,
      backendId: "Back01",
      backendVersion: "v1",
      pageId: "Page01",
      pageVersion: 1,
      sourceNamespace: "legacy",
    },
  ]);
  for (const changed of [
    { ...binding, page: { ...binding.page, version: 2 } },
    { ...binding, name: "other" },
    {
      ...binding,
      tables: [
        {
          ...binding.tables[0]!,
          columns: [{ name: "owner", type: "string" as const }],
        },
      ],
    },
  ])
    assert.throws(() =>
      projectMigrationUserChoiceBindings(
        "legacy",
        [{ version: 1, mutations: [mutation] }],
        [changed],
      ),
    );
  assert.deepEqual(
    projectMigrationUserChoiceBindings(
      "legacy",
      [{ version: 1, mutations: [{} as LegacyMutationDescriptor] }],
      [binding],
    ),
    [],
  );
});
