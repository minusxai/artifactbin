import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { MAX_COMPILED_SOURCE_BYTES } from "./contracts.ts";
import { validLocalValue, normalizeLocalTimestamp } from "./local-state.ts";
import type { LocalDeclaration, LocalColumnType } from "./local-contracts.ts";
import type {
  ReadLocalSourceManifest,
  ReconcileLocalDeclarations,
} from "./source-admission-contracts.ts";
type Node = { type: string; [key: string]: any };
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
function refuse(): never {
  throw Error("Unsupported source declaration");
}
/** Decode the admitted literal grammar only. This never evaluates JavaScript. */
function literal(node: Node | undefined): unknown {
  if (!node) return refuse();
  if (node.type === "JSXExpressionContainer") return literal(node.expression);
  if (
    node.type === "Literal" &&
    (node.value === null ||
      ["string", "boolean", "number"].includes(typeof node.value))
  ) {
    if (typeof node.value === "number" && !Number.isFinite(node.value))
      refuse();
    return node.value;
  }
  if (node.type === "TemplateLiteral" && !node.expressions.length)
    return node.quasis[0]?.value.cooked;
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
    return node.elements.map((entry: Node) => literal(entry));
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
      value[key] = literal(property.value);
    }
    return value;
  }
  return refuse();
}
function inferredColumns(rows: Record<string, unknown>[]) {
  const columns = new Map<string, LocalColumnType | "">();
  for (const row of rows)
    for (const [name, value] of Object.entries(row)) {
      if (!columns.has(name)) columns.set(name, "");
      if (value === null) continue;
      let type = typeof value as LocalColumnType;
      if (type === "string") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value as string)) type = "date";
        else if (
          /^\d{4}-/.test(value as string) &&
          validLocalValue(
            { name: "timestamp", type: "timestamp", default: null },
            value,
          )
        )
          type = "timestamp";
      }
      const previous = columns.get(name)!;
      columns.set(name, !previous || previous === type ? type : "string");
    }
  return [...columns].map(([name, type]) => ({
    name,
    type: type || ("string" as LocalColumnType),
  }));
}
/** Shared with full source admission so one parsed AST owns the manifest. */
export function sourceValueDeclaration(node: Node): LocalDeclaration {
  const attrs: Record<string, unknown> = Object.create(null);
  for (const attr of node.openingElement.attributes) {
    const name = attr.name?.name;
    if (
      attr.type !== "JSXAttribute" ||
      typeof name !== "string" ||
      Object.hasOwn(attrs, name) ||
      !["name", "type", "default", "value", "columns", "url"].includes(name)
    )
      refuse();
    attrs[name] = attr.value ? literal(attr.value) : true;
  }
  const type = attrs.type ?? "string";
  if (
    typeof attrs.name !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(attrs.name) ||
    forbidden.has(attrs.name) ||
    ![
      "string",
      "number",
      "boolean",
      "date",
      "timestamp",
      "user",
      "table",
    ].includes(String(type))
  )
    refuse();
  if (Object.hasOwn(attrs, "url") && typeof attrs.url !== "boolean") refuse();
  let declaration: LocalDeclaration;
  if (type === "table") {
    if (
      Object.hasOwn(attrs, "default") ||
      Object.hasOwn(attrs, "url") ||
      !Array.isArray(attrs.value) ||
      (!attrs.value.length && !Object.hasOwn(attrs, "columns"))
    )
      refuse();
    for (const row of attrs.value) {
      if (!row || typeof row !== "object" || Array.isArray(row)) refuse();
      if (
        Object.values(row).some(
          (v) =>
            v !== null && !["string", "number", "boolean"].includes(typeof v),
        )
      )
        refuse();
    }
    const inferred = inferredColumns(attrs.value);
    let columns = inferred;
    if (Object.hasOwn(attrs, "columns")) {
      if (!Array.isArray(attrs.columns)) refuse();
      for (const column of attrs.columns)
        if (
          !column ||
          typeof column !== "object" ||
          Array.isArray(column) ||
          typeof column.name !== "string" ||
          Object.keys(column).some((key) => !["name", "type"].includes(key)) ||
          ![
            "string",
            "number",
            "boolean",
            "date",
            "timestamp",
            "user",
          ].includes(column.type)
        )
          refuse();
      const names = new Set(attrs.columns.map((c) => c.name));
      if (names.size !== attrs.columns.length) refuse();
      columns = [
        ...attrs.columns,
        ...inferred.filter((c) => !names.has(c.name)),
      ];
    }
    declaration = {
      name: attrs.name,
      type: "table",
      default: attrs.value,
      columns,
    } as LocalDeclaration;
  } else {
    if (Object.hasOwn(attrs, "value") || Object.hasOwn(attrs, "columns"))
      refuse();
    declaration = {
      name: attrs.name,
      type,
      default:
        type === "timestamp" && attrs.default != null
          ? normalizeLocalTimestamp(attrs.default)
          : (attrs.default ?? null),
    } as LocalDeclaration;
  }
  if (!validLocalValue(declaration, declaration.default)) refuse();
  return declaration;
}
export const readLocalSourceManifest: ReadLocalSourceManifest = (source) => {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source) > MAX_COMPILED_SOURCE_BYTES
  )
    refuse();
  const text = "<> " + source + " </>",
    tree = Parser.extend(jsx()).parseExpressionAt(text, 0, {
      ecmaVersion: "latest",
    }) as Node;
  if (tree.end !== text.length) refuse();
  const declarations: LocalDeclaration[] = [],
    names = new Set<string>();
  const walk = (node: Node) => {
    if (
      node.type === "JSXElement" &&
      node.openingElement.name.name === "Value"
    ) {
      const declaration = sourceValueDeclaration(node);
      if (names.has(declaration.name)) refuse();
      names.add(declaration.name);
      declarations.push(declaration);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "start" || key === "end") continue;
      if (Array.isArray(value))
        value.forEach((v) => {
          if (v && typeof v === "object") walk(v);
        });
      else if (value && typeof value === "object") walk(value);
    }
  };
  walk(tree);
  return { declarations };
};
function same(expected: unknown, actual: unknown): boolean {
  if (expected === actual) return true;
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((v, i) => same(v, actual[i]))
    );
  if (
    !expected ||
    typeof expected !== "object" ||
    !actual ||
    typeof actual !== "object" ||
    Array.isArray(actual)
  )
    return false;
  const a = expected as Record<string, unknown>,
    b = actual as Record<string, unknown>,
    keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
  );
}
export const reconcileLocalDeclarations: ReconcileLocalDeclarations = (
  manifest,
  declarations,
) => {
  if (
    !Array.isArray(declarations) ||
    declarations.length !== manifest.declarations.length
  )
    return false;
  const byName = new Map(declarations.map((d) => [d?.name, d]));
  return (
    byName.size === declarations.length &&
    manifest.declarations.every((d) => same(d, byName.get(d.name)))
  );
};
