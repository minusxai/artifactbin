import type { NativeComponentRule } from "../component-map.ts";
import type { NativeLowerBlocker } from "../lower.ts";
import type { NativeJson, RetainedJsxNode } from "../analyze-contracts.ts";

/** Output of the source Tabs prop normalization pass. */
export interface PreparedNativeTabs {
  node: RetainedJsxNode;
  blockers: readonly NativeLowerBlocker[];
}

/** The reviewed html-components/tabs.ts contract. */
export const NATIVE_TABS_RULES: readonly NativeComponentRule[] = Object.freeze([
  {
    tag: "Tabs",
    htmlTag: "af-tabs",
    kind: "native",
    module: "tabs",
    register: "registerTabs",
    attributes: {
      defaultValue: "string",
      orientation: ["horizontal", "vertical"],
      "activation-mode": ["automatic", "manual"],
      dir: ["ltr", "rtl"],
      loop: "boolean",
    },
    properties: ["value"],
  },
  {
    tag: "TabsList",
    htmlTag: "af-tabs-list",
    kind: "native",
    module: "tabs",
    register: "registerTabs",
    attributes: { variant: ["default", "line"] },
    parent: ["Tabs"],
  },
  {
    tag: "TabsTrigger",
    htmlTag: "af-tabs-trigger",
    kind: "native",
    module: "tabs",
    register: "registerTabs",
    attributes: { value: "string", disabled: "boolean" },
    parent: ["TabsList"],
  },
  {
    tag: "TabsContent",
    htmlTag: "af-tabs-content",
    kind: "native",
    module: "tabs",
    register: "registerTabs",
    attributes: { value: "string" },
    parent: ["Tabs"],
  },
]);

const rulesByTag = new Map(NATIVE_TABS_RULES.map((rule) => [rule.tag, rule]));
const commonAttributes = new Set([
  "id",
  "class",
  "className",
  "title",
  "role",
  "lang",
  "tabIndex",
  "hidden",
  "inert",
  "slot",
  "style",
  "data-af-id",
]);

function validLiteral(value: NativeJson, kind: NonNullable<NativeComponentRule["attributes"]>[string]): boolean {
  if (Array.isArray(kind)) return typeof value === "string" && kind.includes(value);
  if (kind === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === kind;
}

function blocker(node: Extract<RetainedJsxNode, { type: "element" }>, code: string, detail: string, attribute?: string): NativeLowerBlocker {
  return { code, sourceNode: node.graphKey, tag: node.tag, detail, ...(attribute ? { attribute } : {}) };
}

/** Normalize the source Tabs API before generic native-component lowering. */
export function prepareNativeTabs(node: RetainedJsxNode): PreparedNativeTabs {
  if (node.type !== "element" || !rulesByTag.has(node.tag)) return { node, blockers: [] };

  const rule = rulesByTag.get(node.tag)!;
  const blockers: NativeLowerBlocker[] = [];
  const normalizedAttributes = node.attributes.map((attribute) =>
    node.tag === "Tabs" && attribute.name === "activationMode"
      ? { ...attribute, name: "activation-mode" }
      : attribute,
  );
  const seen = new Set<string>();

  for (const attribute of normalizedAttributes) {
    const name = attribute.name;
    if (seen.has(name)) {
      blockers.push(blocker(node, "tabs-duplicate-attribute", "Source aliases resolve to the same target Tabs attribute", name));
      continue;
    }
    seen.add(name);

    if (node.tag === "Tabs" && name === "onValueChange") {
      blockers.push(blocker(node, "tabs-change-handler-unsupported", "Preserve controlled selection through the value binding and af-change writeback; callback translation requires an admitted author program", name));
      continue;
    }

    if (commonAttributes.has(name) || name.startsWith("aria-") || name.startsWith("data-")) continue;

    if (name === "value" && rule.properties?.includes(name)) {
      if (attribute.value.static && attribute.value.json !== null && typeof attribute.value.json !== "string") {
        blockers.push(blocker(node, "tabs-unsupported-attribute-value", "Controlled Tabs value must be a string or an admitted dynamic value binding", name));
      }
      continue;
    }

    const kind = rule.attributes?.[name];
    if (!kind) {
      blockers.push(blocker(node, "tabs-unsupported-attribute", "This source Tabs prop has no matching target contract and cannot be dropped", name));
      continue;
    }
    if (!attribute.value.static) {
      blockers.push(blocker(node, "tabs-dynamic-attribute-unsupported", "This Tabs prop requires a source literal; only controlled Tabs.value has native change writeback", name));
      continue;
    }
    if (!validLiteral(attribute.value.json, kind)) {
      blockers.push(blocker(node, "tabs-unsupported-attribute-value", "Source Tabs prop value is outside the reviewed native contract", name));
    }
  }

  const prepared: Extract<RetainedJsxNode, { type: "element" }> = {
    ...node,
    attributes: normalizedAttributes,
    children: node.children,
  };
  return { node: prepared, blockers };
}
