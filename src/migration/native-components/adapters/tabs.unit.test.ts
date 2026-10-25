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
  assert.deepEqual(NATIVE_TABS_RULES[0]?.attributes?.orientation, ["horizontal", "vertical"]);
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

test("target-only activation and looping props fail closed instead of changing source behavior", () => {
  const activation = element("Tabs", [staticAttribute("activationMode", "manual")]);
  const rootLoop = element("Tabs", [staticAttribute("loop", false)]);
  const listLoop = element("TabsList", [staticAttribute("loop", false)]);
  assert.ok(prepareNativeTabs(activation).blockers.some((b) => b.code === "tabs-unsupported-attribute" && b.attribute === "activationMode"));
  assert.ok(prepareNativeTabs(rootLoop).blockers.some((b) => b.code === "tabs-unsupported-attribute" && b.attribute === "loop"));
  assert.ok(prepareNativeTabs(listLoop).blockers.some((b) => b.code === "tabs-unsupported-attribute" && b.attribute === "loop"));
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

test("the five retained source heads use only supported Tabs props and retain their paired panels", () => {
  const years = Array.from({ length: 16 }, (_, index) => 2026 - index);
  const fixtures = [
    {
      head: "6bXsx3@111",
      selected: "all",
      list: [staticAttribute("className", "mx-tablist"), staticAttribute("id", "OJYy")],
      values: ["all", ...years.map((year) => `y${year}`)],
      triggers: ["All", ...years.map(String)],
      contentClass: undefined,
    },
    {
      head: "Fxs5JI@18",
      selected: "individuals",
      list: [staticAttribute("variant", "line"), staticAttribute("className", "w-full justify-start gap-8 rounded-none border-b border-border p-0")],
      values: ["individuals", "companies"],
      triggers: ["Individuals", "Companies"],
      contentClass: "mt-10",
    },
    {
      head: "Uqwg0H@36",
      selected: "table",
      list: [staticAttribute("className", "no-print")],
      values: ["table", "cards", "grocery", "recipes", "hindi", "rotation"],
      triggers: ["Classic table", "Day cards", "Grocery", "Recipes", "Cook Hinglish", "Menu bank"],
      contentClass: "mt-7",
    },
    {
      head: "haPmQt@21",
      selected: "select",
      list: [],
      values: ["select", "replace", "undo"],
      triggers: ["1. Select", "2. Replace", "3. Undo"],
      contentClass: undefined,
    },
    {
      head: "x8CE5C@9",
      selected: "all",
      list: [staticAttribute("className", "mx-tablist"), staticAttribute("id", "HRwr")],
      values: ["all", ...years.map((year) => `y${year}`)],
      triggers: ["All", ...years.map(String)],
      contentClass: undefined,
    },
  ];

  for (const fixture of fixtures) {
    const triggerNodes = fixture.values.map((value, index) =>
      element("TabsTrigger", [
        staticAttribute("value", value),
        ...(fixture.head === "6bXsx3@111" || fixture.head === "x8CE5C@9" ? [staticAttribute("className", "mx-tab")] : []),
      ], [{ type: "text", graphKey: `${fixture.head}-trigger-${index}`, start: 1, end: 2, value: fixture.triggers[index]! }]),
    );
    const contentNodes = fixture.values.map((value, index) =>
      element("TabsContent", [
        staticAttribute("value", value),
        ...(fixture.contentClass ? [staticAttribute("className", fixture.contentClass)] : []),
      ], [{ type: "text", graphKey: `${fixture.head}-panel-${index}`, start: 3, end: 4, value: `panel ${value}` }]),
    );
    const root = element("Tabs", [staticAttribute("defaultValue", fixture.selected)], [
      element("TabsList", fixture.list, triggerNodes),
      ...contentNodes,
    ]);
    const visit = (node: RetainedJsxNode): void => {
      const result = prepareNativeTabs(node);
      assert.deepEqual(result.blockers, [], `${fixture.head} ${node.type === "element" ? node.tag : node.graphKey}`);
      if (node.type === "element") node.children.forEach(visit);
    };
    visit(root);
    assert.equal(root.attributes.find((attribute) => attribute.name === "defaultValue")?.value.static, true, fixture.head);
    assert.equal(root.children.filter((node) => node.type === "element" && node.tag === "TabsContent").length, fixture.values.length, fixture.head);
    assert.deepEqual(triggerNodes.map((node) => node.attributes.find((attribute) => attribute.name === "value")?.value), contentNodes.map((node) => node.attributes.find((attribute) => attribute.name === "value")?.value), fixture.head);
  }
});
