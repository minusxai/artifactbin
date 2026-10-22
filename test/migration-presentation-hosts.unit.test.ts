import { test } from "node:test";
import assert from "node:assert/strict";
import { preservePresentationHosts } from "../src/migration/conversion/compiled/presentation-hosts.ts";
import type { ArchivedPresentationNode } from "../src/migration/conversion/compiled/presentation-host-contracts.ts";
const node: ArchivedPresentationNode = {
  type: "element",
  tag: "Tooltip",
  isComponent: true,
  start: 0,
  end: 9,
  selfClosing: false,
  attributes: [
    { name: "id", value: { static: true, json: "tip" }, start: 0, end: 1 },
    {
      name: "delayDuration",
      value: { static: true, json: 0 },
      start: 1,
      end: 2,
    },
  ],
  children: [
    {
      type: "element",
      tag: "TooltipTrigger",
      start: 3,
      end: 5,
      attributes: [],
      children: [],
    },
  ],
};
test("transparent presentation identities use one layout-neutral host without moving provider children", () => {
  const before = structuredClone(node);
  const [wrapped] = preservePresentationHosts(
    [node],
    [{ tag: "Tooltip", id: "tip" }],
  );
  assert.ok(wrapped);
  assert.equal(wrapped.tag, "span");
  assert.deepEqual(
    wrapped.attributes?.map((a) => [a.name, a.value.json]),
    [
      ["id", "tip"],
      ["style", { display: "contents" }],
    ],
  );
  const inner = wrapped.children?.[0];
  assert.ok(inner);
  assert.equal(inner.tag, "Tooltip");
  assert.deepEqual(
    inner.attributes?.map((a) => a.name),
    ["delayDuration"],
  );
  assert.deepEqual(inner.children, node.children);
  assert.deepEqual(node, before);
});
test("presentation host plans fail closed for missing, duplicate or mismatched source nodes", () => {
  assert.throws(() =>
    preservePresentationHosts([node], [{ tag: "TooltipProvider", id: "tip" }]),
  );
  assert.throws(() =>
    preservePresentationHosts([node, node], [{ tag: "Tooltip", id: "tip" }]),
  );
  assert.throws(() =>
    preservePresentationHosts(
      [node],
      [
        { tag: "Tooltip", id: "tip" },
        { tag: "Tooltip", id: "tip" },
      ],
    ),
  );
});
