import assert from "node:assert/strict";
import test from "node:test";
import { archivedRuntimePlan } from "../src/migration/conversion/compiled/runtime-plan.ts";
import type { ArchivedRuntimeRequirements } from "../src/migration/conversion/compiled/runtime-plan-contracts.ts";
const empty: ArchivedRuntimeRequirements = {
  sql: false,
  author: false,
  charts: false,
  datasetMutations: false,
  dataControls: false,
  slideDeck: false,
  mermaid: false,
  dialogFocus: false,
  person: false,
  viewer: false,
  members: false,
  fonts: false,
  context: false,
};
test("preserves graph parity for every combination of source-requiring adapters", () => {
  const adapters = [
    "sql",
    "author",
    "charts",
    "datasetMutations",
    "dataControls",
    "slideDeck",
    "mermaid",
    "dialogFocus",
  ] as const;
  for (let mask = 0; mask < 256; mask++) {
    const requirements = { ...empty };
    adapters.forEach((name, index) => {
      requirements[name] = Boolean(mask & (1 << index));
    });
    const plan = archivedRuntimePlan(requirements);
    assert.equal(
      plan.kitGraph,
      mask ? "source" : "manifest",
      `adapter combination ${mask}`,
    );
    assert.equal(
      plan.capabilities.length,
      adapters.filter((_, i) => mask & (1 << i)).length,
    );
  }
});
test("metadata and trusted read bindings retain manifest graph unless a source adapter is present", () => {
  const requirements = {
    ...empty,
    person: false,
    viewer: true,
    members: true,
    fonts: true,
    context: true,
  };
  const plan = archivedRuntimePlan(requirements);
  assert.equal(plan.kitGraph, "manifest");
  assert.deepEqual(plan.capabilities, [
    "viewer",
    "members",
    "fonts",
    "context",
  ]);
  const mixed = archivedRuntimePlan({
    ...requirements,
    datasetMutations: true,
  });
  assert.equal(mixed.kitGraph, "source");
  assert.deepEqual(mixed.capabilities, [
    "dataset-mutations",
    ...plan.capabilities,
  ]);
});
test("plans are isolated immutable snapshots across later compiler preparation", () => {
  const requirements = { ...empty, dialogFocus: true };
  const first = archivedRuntimePlan(requirements);
  requirements.dialogFocus = false;
  assert.equal(first.kitGraph, "source");
  assert.deepEqual(first.capabilities, ["dialog-focus"]);
  assert.equal(archivedRuntimePlan(requirements).kitGraph, "manifest");
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.capabilities));
});

test("person profiles require the source kit even without SQL so trusted navigation adapter executes", () => {
  assert.equal(
    archivedRuntimePlan({ ...empty, person: true }).kitGraph,
    "source",
  );
});
