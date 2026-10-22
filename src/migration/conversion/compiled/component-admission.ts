import {admitSlideDeckComponent} from "./slide-deck.ts";
import { admitScalarControl } from "./scalar-controls.ts";
import {
  admitDataControl,
  admitDataColumn,
  controlLiteral,
} from "./data-controls.ts";
import {
  presentationKitComponent,
  admitPresentationKit,
} from "./presentation-kit.ts";
import type {
  AdmitLocalComponent,
  LocalComponentAdmission,
} from "./component-admission-contracts.ts";
type Node = { type: string; [key: string]: any };
const meaningful = (node: Node) =>
  !(node.type === "JSXText" && !node.value.trim()) &&
  !(
    node.type === "JSXExpressionContainer" &&
    node.expression.type === "JSXEmptyExpression"
  );
/** A single family owns all of its static props; no spread or duplicate can hide a prop. */
function attributes(node: Node): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  for (const attr of node.openingElement.attributes) {
    if (
      attr.type !== "JSXAttribute" ||
      typeof attr.name?.name !== "string" ||
      Object.hasOwn(result, attr.name.name)
    )
      throw Error("Invalid component attributes");
    result[attr.name.name] = controlLiteral(attr.value);
  }
  return result;
}
/** Audited kit-family policy only. Never traverses descendants or resolves page symbols. */
export const admitLocalComponent: AdmitLocalComponent = (input, context) => {
  const node = input as Node;
  if (node?.type !== "JSXElement") return null;
  const tag = node.openingElement?.name?.name;
  if (typeof tag !== "string") return null;
  if (tag === "Column") {
    if (context.parentTag !== "DataTable")
      throw Error("Column requires DataTable");
    return {
      references: [],
      scalarBindings: [],
      scalarControls: [],
      dataControls: [],
      presentationIdentityHosts: [],
    };
  }
  if (
    !presentationKitComponent(tag) &&
    !["Segmented", "Switch", "Slider", "Select", "DataTable", "SlideDeck", "Slide"].includes(tag)
  )
    return null;
  const attrs = attributes(node);
  const children: Node[] = node.children.filter(meaningful);
  const result: {
    -readonly [K in keyof LocalComponentAdmission]: LocalComponentAdmission[K];
  } = {
    references: [],
    scalarBindings: [],
    scalarControls: [],
    dataControls: [],
    presentationIdentityHosts: [],
  };
  if (["SlideDeck","Slide"].includes(tag)) {
    admitSlideDeckComponent(tag,attrs);
    return result;
  }
  if (presentationKitComponent(tag)) {
    const capability = admitPresentationKit(tag, attrs, context.ancestors);
    result.identityLifecycle = capability;
    if (capability.scalarBinding) {
      result.references = [capability.scalarBinding.binding];
      result.scalarBindings = [capability.scalarBinding.binding];
      result.scalarControls = [capability.scalarBinding];
    }
    if (capability.identity === "transparent" && typeof attrs.id === "string") {
      if (tag !== "Tooltip" && tag !== "TooltipProvider")
        throw Error("Unsupported transparent identity host");
      result.presentationIdentityHosts = [{ tag, id: attrs.id }];
    }
    return result;
  }
  if (["Segmented", "Switch", "Slider"].includes(tag)) {
    const plan = admitScalarControl(tag, attrs, children.length > 0);
    result.scalarControls = [plan];
    result.references = [plan.binding];
    result.scalarBindings = [plan.binding];
    if (plan.options) {
      result.dataControls = [plan.options];
      if (typeof plan.options.options === "string")
        result.references = [...result.references, plan.options.options];
    }
    return result;
  }
  const columns =
    tag === "DataTable" && children.length
      ? children.map((column) => {
          if (
            column.type !== "JSXElement" ||
            column.openingElement.name.name !== "Column"
          )
            throw Error("Only readonly Columns are supported");
          const props = attributes(column);
          if (Object.hasOwn(props, "hasContent"))
            throw Error("Ambiguous Column attributes");
          return admitDataColumn(props, column.children.some(meaningful));
        })
      : undefined;
  if (columns?.length) {
    if (context.rowTable)
      throw Error("Nested table row scopes are unsupported");
    if (typeof attrs.data !== "string" || !/^\$[A-Za-z]\w*$/.test(attrs.data))
      throw Error("Invalid table row source");
    result.descendantScope = {
      kind: "row",
      table: attrs.data.slice(1),
      ...(typeof attrs.rowKey === "string" ? { key: attrs.rowKey } : {}),
    };
  }
  const plan = admitDataControl(tag, attrs, children.length > 0, columns);
  result.dataControls = [plan];
  if (plan.kind === "select") {
    result.references = [
      plan.value,
      ...(typeof plan.options === "string" ? [plan.options] : []),
    ];
    result.scalarBindings = [plan.value];
  } else result.references = [plan.data];
  return result;
};
