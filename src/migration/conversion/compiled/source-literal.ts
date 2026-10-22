import type { ReadSourceLiteral } from "./source-literal-contracts.ts";
type Node = { type: string; [key: string]: any };
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
function refuse(): never {
  throw Error("Unsupported source literal");
}
/** Decode only finite JSON literals; never evaluate authored expressions. */
export const readSourceLiteral: ReadSourceLiteral = (input, limits = {}) => {
  const maxDepth = limits.maxDepth ?? 128,
    maxNodes = limits.maxNodes ?? 1000000;
  if (
    !Number.isSafeInteger(maxDepth) ||
    maxDepth < 0 ||
    !Number.isSafeInteger(maxNodes) ||
    maxNodes < 1
  )
    refuse();
  let count = 0;
  function decode(node: Node | undefined, depth: number): unknown {
    if (++count > maxNodes || depth > maxDepth) return refuse();
    if (!node) return refuse();
    if (node.type === "JSXExpressionContainer")
      return decode(node.expression, depth + 1);
    if (
      node.type === "Literal" &&
      (node.value === null ||
        ["string", "boolean", "number"].includes(typeof node.value))
    ) {
      if (typeof node.value === "number" && !Number.isFinite(node.value))
        refuse();
      return node.value;
    }
    if (node.type === "TemplateLiteral" && !node.expressions.length) {
      const cooked = node.quasis[0]?.value.cooked;
      if (typeof cooked !== "string") return refuse();
      return cooked;
    }
    if (
      node.type === "UnaryExpression" &&
      ["-", "+"].includes(node.operator) &&
      node.argument?.type === "Literal" &&
      typeof node.argument.value === "number"
    ) {
      const value =
        node.operator === "-" ? -node.argument.value : +node.argument.value;
      if (!Number.isFinite(value)) refuse();
      return value;
    }
    if (node.type === "ArrayExpression")
      return Array.from(node.elements, (entry: Node) =>
        decode(entry, depth + 1),
      );
    if (node.type === "ObjectExpression") {
      const value: Record<string, unknown> = {};
      for (const property of node.properties) {
        if (
          property.type !== "Property" ||
          property.computed ||
          property.method ||
          property.kind !== "init"
        )
          refuse();
        const rawKey = property.key.name ?? property.key.value;
        const key = typeof rawKey === "number" ? String(rawKey) : rawKey;
        if (
          typeof key !== "string" ||
          forbidden.has(key) ||
          Object.hasOwn(value, key)
        )
          refuse();
        value[key] = decode(property.value, depth + 1);
      }
      return value;
    }
    return refuse();
  }

  return decode(input as Node, 0);
};
