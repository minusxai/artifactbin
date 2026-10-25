import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_MERMAID_RULES, prepareNativeMermaid } from "./mermaid.ts";
import type {
  NativeJson,
  RetainedAttribute,
  RetainedJsxNode,
} from "../analyze-contracts.ts";

type RetainedElement = Extract<RetainedJsxNode, { type: "element" }>;
const asElement = (node: RetainedJsxNode): RetainedElement => {
  assert.equal(node.type, "element");
  return node as RetainedElement;
};
const attr = (
  name: string,
  json: NativeJson,
  start = 11,
  end = 20,
): RetainedAttribute => ({
  name,
  start,
  end,
  value: { static: true as const, json },
});
const element = (
  attributes: ReturnType<typeof attr>[],
  children: RetainedJsxNode[] = [],
): RetainedElement => ({
  type: "element",
  graphKey: "source-mermaid",
  start: 10,
  end: 90,
  tag: "Mermaid",
  authoredTag: "Mermaid",
  isComponent: true,
  attributes,
  children,
  selfClosing: children.length === 0,
});
const text = (
  graphKey: string,
  value: string,
  start: number,
): RetainedJsxNode => ({
  type: "text",
  graphKey,
  value,
  start,
  end: start + value.length,
});
const jsonOf = (attribute: RetainedAttribute | undefined): NativeJson => {
  if (!attribute || !attribute.value.static)
    throw new Error("Expected static retained attribute");
  return attribute.value.json;
};
const expression = (
  graphKey: string,
  json: NativeJson,
  start: number,
): RetainedJsxNode => ({
  type: "expression",
  graphKey,
  start,
  end: start + 8,
  value: { static: true, json },
  source: JSON.stringify(json),
});

test("declares the exact native Mermaid module and runtime properties", () => {
  assert.deepEqual(NATIVE_MERMAID_RULES, [
    {
      tag: "Mermaid",
      htmlTag: "af-mermaid",
      kind: "native",
      module: "mermaid",
      register: "registerMermaid",
      attributes: {
        code: "string",
        title: "string",
        "color-mode": ["light", "dark", "auto"],
      },
      properties: [],
    },
  ]);
});

test("keeps code, title, id and explicit color-mode without losing graph identity or source spans", () => {
  const source = element([
    attr("code", "flowchart LR\n A-->B"),
    attr("title", "System"),
    attr("color-mode", "dark"),
    attr("id", "diagram"),
  ]);
  const result = prepareNativeMermaid(source);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.node.graphKey, source.graphKey);
  assert.equal(result.node.start, source.start);
  assert.equal(result.node.end, source.end);
  assert.deepEqual(asElement(result.node).attributes, source.attributes);
  assert.equal(asElement(result.node).children, source.children);
});

test("normalizes initial literal text and static string expressions to the target code attribute exactly", () => {
  const source = element(
    [],
    [
      text("text-a", "\nflowchart LR\n A-->B\n", 30),
      expression("expr-b", "\nC-->D", 70),
    ],
  );
  const result = prepareNativeMermaid(source);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(
    asElement(result.node).attributes.map((a) => a.name),
    ["code"],
  );
  assert.deepEqual(asElement(result.node).attributes[0], {
    name: "code",
    start: 30,
    end: 78,
    value: { static: true, json: "\nflowchart LR\n A-->B\n\nC-->D" },
  });
  assert.deepEqual(asElement(result.node).children, source.children);
  assert.equal(asElement(result.node).children[0]?.graphKey, "text-a");
  assert.equal(asElement(result.node).children[1]?.graphKey, "expr-b");
});

test("static colorMode maps to the product color-mode attribute without changing mode", () => {
  const source = element([attr("colorMode", "auto")]);
  const result = prepareNativeMermaid(source);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(asElement(result.node).attributes, [
    {
      name: "color-mode",
      start: 11,
      end: 20,
      value: { static: true, json: "auto" },
    },
  ]);
});

test("explicit code takes precedence over literal children, matching AfMermaid.code", () => {
  const source = element(
    [attr("code", "flowchart LR\n A-->B")],
    [text("ignored", "other child", 50)],
  );
  const result = prepareNativeMermaid(source);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(asElement(result.node).attributes[0], source.attributes[0]);
  assert.equal(asElement(result.node).children[0]?.graphKey, "ignored");
});

test("blocks dynamic code and leaves retained source unchanged for binding review", () => {
  const source = element([
    {
      name: "code",
      start: 11,
      end: 20,
      value: { static: false, exprType: "Identifier", source: "diagramCode" },
    },
  ]);
  const result = prepareNativeMermaid(source);
  assert.deepEqual(result.node, source);
  assert.deepEqual(
    result.blockers.map((x) => x.code),
    ["mermaid-dynamic-code"],
  );
  assert.equal(result.blockers[0]?.sourceNode, source.graphKey);
});

test("blocks dynamic child expressions rather than replacing them with guessed text", () => {
  const child: RetainedJsxNode = {
    type: "expression",
    graphKey: "dynamic-code",
    start: 30,
    end: 50,
    value: { static: false, exprType: "Identifier", source: "diagramCode" },
    source: "diagramCode",
  };
  const source = element([], [text("leading", "\n", 29), child]);
  const result = prepareNativeMermaid(source);
  assert.deepEqual(result.node, source);
  assert.deepEqual(
    result.blockers.map((x) => x.code),
    ["mermaid-dynamic-code"],
  );
  assert.equal(result.blockers[0]?.sourceNode, child.graphKey);
});

test("blocks nested child elements and retains their source identities", () => {
  const nested: RetainedJsxNode = {
    type: "element",
    graphKey: "nested",
    start: 30,
    end: 60,
    tag: "span",
    isComponent: false,
    attributes: [],
    children: [],
    selfClosing: true,
  };
  const source = element([], [nested]);
  const result = prepareNativeMermaid(source);
  assert.deepEqual(result.node, source);
  assert.deepEqual(
    result.blockers.map((x) => x.code),
    ["mermaid-child-element-unsupported"],
  );
  assert.equal(result.blockers[0]?.sourceNode, nested.graphKey);
});

test("blocks unknown theme/config props without silently dropping authored config", () => {
  for (const name of ["theme", "config", "securityLevel"]) {
    const source = element([attr(name, { theme: "dark" })]);
    const result = prepareNativeMermaid(source);
    assert.deepEqual(result.node, source);
    assert.deepEqual(
      result.blockers.map((x) => x.code),
      ["mermaid-config-unsupported"],
    );
    assert.equal(result.blockers[0]?.attribute, name);
  }
});

test("blocks invalid or conflicting color mode props", () => {
  const invalid = prepareNativeMermaid(
    element([attr("color-mode", "darkest")]),
  );
  assert.deepEqual(
    invalid.blockers.map((x) => x.code),
    ["mermaid-color-mode-invalid"],
  );
  const conflict = prepareNativeMermaid(
    element([attr("colorMode", "dark"), attr("color-mode", "light")]),
  );
  assert.deepEqual(
    conflict.blockers.map((x) => x.code),
    ["mermaid-color-mode-ambiguous"],
  );
});

test("passes invalid Mermaid syntax through unchanged so af-mermaid can show its existing error state", () => {
  const invalid = "not a Mermaid diagram";
  const result = prepareNativeMermaid(element([attr("code", invalid)]));
  assert.deepEqual(result.blockers, []);
  assert.equal(jsonOf(asElement(result.node).attributes[0]), invalid);
});

test("leaves absent or empty source code to af-mermaid’s existing syntax error flow", () => {
  const absent = prepareNativeMermaid(element([]));
  const empty = prepareNativeMermaid(
    element([], [text("empty-source", "", 30)]),
  );
  assert.deepEqual(absent.blockers, []);
  assert.deepEqual(asElement(absent.node).attributes, []);
  assert.deepEqual(empty.blockers, []);
  assert.equal(jsonOf(asElement(empty.node).attributes[0]), "");
});
