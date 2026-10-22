import { readSourceLiteral } from "./source-literal.ts";
import type { LocalDeclaration } from "./local-contracts.ts";
/** Frozen bound-Value grammar has only user/null. This placeholder carries no
 * source/column authority and is used only by explicit historical unavailable mode. */
export function historicalSourceValueDeclaration(node: any): LocalDeclaration {
  const refuse = (): never => {
    throw Error("Unsupported historical bound Value");
  };
  if (
    node?.type !== "JSXElement" ||
    node.openingElement?.name?.name !== "Value"
  )
    refuse();
  const attrs: Record<string, unknown> = Object.create(null);
  for (const attr of node.openingElement.attributes) {
    const name = attr.name?.name;
    if (
      attr.type !== "JSXAttribute" ||
      !["name", "source", "column"].includes(name) ||
      Object.hasOwn(attrs, name) ||
      !attr.value
    )
      refuse();
    attrs[name] = readSourceLiteral(attr.value);
  }
  if (
    Object.keys(attrs).length !== 3 ||
    typeof attrs.name !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(attrs.name) ||
    ["__proto__", "constructor", "prototype"].includes(attrs.name) ||
    typeof attrs.source !== "string" ||
    !/^ref:[A-Za-z0-9]{6,12}$/.test(attrs.source) ||
    typeof attrs.column !== "string" ||
    !attrs.column ||
    attrs.column.length > 256 ||
    ["__proto__", "constructor", "prototype"].includes(attrs.column)
  )
    refuse();
  return { name: attrs.name as string, type: "user", default: null };
}
