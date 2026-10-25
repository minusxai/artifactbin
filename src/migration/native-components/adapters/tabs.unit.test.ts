import { test } from "node:test";
import assert from "node:assert/strict";
import type { NativeJson, RetainedAttribute, RetainedJsxNode } from "../analyze-contracts.ts";
import { NATIVE_TABS_RULES, prepareNativeTabs } from "./tabs.ts";

let sequence = 0;
const staticAttribute = (name: string, json: NativeJson) => ({
  name,
  value: { static: true as const, json },
  start: 10,
  end: 20,
});
const dynamicAttribute = (name: string, source: string) => ({
  name,
  value: { static: false as const, exprType: "Identifier", source },
  start: 10,
  end: 20,
});
function element(
  tag: string,
  attributes: RetainedAttribute[] = [],
  children: RetainedJsxNode[] = [],
): Extract<RetainedJsxNode, { type: "element" }> {
  return {
    type: "element",
    tag,
    isComponent: /^[A-Z]/.test(tag),
    selfClosing: children.length === 0,
    graphKey: `source-${++sequence}`,
    start: 1,
    end: 100,
    attributes: attributes as Extract<RetainedJsxNode, { type: "element" }>["attributes"],
    children,
  };
}

test("Tabs rules map the four source parts to the reviewed native contract", () => {
  assert.deepEqual(
    NATIVE_TABS_RULES.map(({ tag, htmlTag, module, register, parent }) => ({
      tag,
      htmlTag,
      module,
      register,
      parent,
    })),
    [
      { tag: "Tabs", htmlTag: "af-tabs", module: "tabs", register: "registerTabs", parent: undefined },
      { tag: "TabsList", htmlTag: "af-tabs-list", module: "tabs", register: "registerTabs", parent: ["Tabs"] },
      { tag: "TabsTrigger", htmlTag: "af-tabs-trigger", module: "tabs", register: "registerTabs", parent: ["TabsList"] },
      { tag: "TabsContent", htmlTag: "af-tabs-content", module: "tabs", register: "registerTabs", parent: ["Tabs"] },
    ],
  );
  assert.deepEqual(NATIVE_TABS_RULES[0]?.properties, ["value"]);
  assert.deepEqual(NATIVE_TABS_RULES[0]?.attributes?.["activation-mode"], ["automatic", "manual"]);
});

test("default and controlled selection props preserve values, identity, spans, and children", () => {
  const label: RetainedJsxNode = { type: "text", graphKey: "tab-label", start: 21, end: 22, value: "Overview" };
  const trigger = element("TabsTrigger", [staticAttribute("value", "overview")], [label]);
  const content = element("TabsContent", [staticAttribute("value", "overview")], []);
  const root = element(
    "Tabs",
    [
      staticAttribute("defaultValue", "overview"),
      dynamicAttribute("value", "$selected"),
      staticAttribute("orientation", "vertical"),
      staticAttribute("activationMode", "manual"),
    ],
    [element("TabsList", [], [trigger]), content],
  );

  const result = prepareNativeTabs(root);
  assert.deepEqual(result.blockers, []);
  assert.notEqual(result.node, root);
  assert.equal(result.node.graphKey, root.graphKey);
  assert.equal(result.node.start, root.start);
  assert.equal(result.node.end, root.end);
  const prepared = result.node;
  if (prepared.type !== "element") throw new Error("Tabs root should remain an element");
  assert.deepEqual(prepared.attributes.map((attr) => attr.name), [
    "defaultValue",
    "value",
    "orientation",
    "activation-mode",
  ]);
  assert.deepEqual(prepared.children, root.children);
  assert.equal(prepared.children[0], root.children[0]);
  assert.equal(prepared.children[0]?.type, "element");
  assert.equal(trigger.children[0], label);
});

test("TabsList variant and trigger/content values are constrained source attributes", () => {
  const list = prepareNativeTabs(element("TabsList", [staticAttribute("variant", "line")]));
  const trigger = prepareNativeTabs(element("TabsTrigger", [staticAttribute("value", "all"), staticAttribute("disabled", true)]));
  const content = prepareNativeTabs(element("TabsContent", [staticAttribute("value", "all")]));
  assert.deepEqual(list.blockers, []);
  assert.deepEqual(trigger.blockers, []);
  assert.deepEqual(content.blockers, []);
  assert.deepEqual(list.node.type === "element" && list.node.attributes.map((a) => a.name), ["variant"]);
});

test("invalid enum values and unknown props fail closed with source attribution", () => {
  const invalid = element("Tabs", [staticAttribute("orientation", "diagonal"), staticAttribute("unexpected", "drop-me")]);
  const result = prepareNativeTabs(invalid);
  assert.deepEqual(result.blockers.map((blocker) => [blocker.code, blocker.sourceNode, blocker.attribute]), [
    ["tabs-unsupported-attribute-value", invalid.graphKey, "orientation"],
    ["tabs-unsupported-attribute", invalid.graphKey, "unexpected"],
  ]);
  if (result.node.type !== "element") throw new Error("invalid Tabs node should remain an element");
  assert.deepEqual(result.node.attributes, invalid.attributes);
});

test("activationMode normalizes once and ambiguous aliases are rejected", () => {
  const node = element("Tabs", [
    staticAttribute("activationMode", "automatic"),
    staticAttribute("activation-mode", "manual"),
  ]);
  const result = prepareNativeTabs(node);
  assert.ok(result.blockers.some((blocker) => blocker.code === "tabs-duplicate-attribute" && blocker.attribute === "activation-mode"));
});

test("value change callbacks are not discarded; controlled value remains the supported writeback path", () => {
  const controlled = prepareNativeTabs(element("Tabs", [dynamicAttribute("value", "$selected")]));
  const callback = prepareNativeTabs(element("Tabs", [dynamicAttribute("onValueChange", "setSelected")]));
  assert.deepEqual(controlled.blockers, []);
  assert.ok(callback.blockers.some((blocker) => blocker.code === "tabs-change-handler-unsupported" && blocker.attribute === "onValueChange"));
  if (callback.node.type !== "element") throw new Error("callback Tabs node should remain an element");
  assert.equal(callback.node.attributes[0]?.name, "onValueChange");
});

test("unrelated source nodes pass through unchanged", () => {
  const node = element("section", [staticAttribute("id", "summary")]);
  const result = prepareNativeTabs(node);
  assert.equal(result.node, node);
  assert.deepEqual(result.blockers, []);
});
