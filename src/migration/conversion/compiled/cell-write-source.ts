import { admitDataControl } from "./data-controls.ts";
/** Offline source classification only; schema types must come from verified SQL/catalog analysis. */
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { readLocalSourceLiteral } from "./source-manifest.ts";
import { MAX_COMPILED_SOURCE_BYTES } from "./contracts.ts";
import type {
  ReadLegacyCellWriteSites,
  TypeLegacyCellWriteSites,
  LegacyCellWriteSite,
} from "./cell-write-contracts.ts";
const name = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
const ref = (v: unknown): string | undefined =>
  typeof v === "string" && v.startsWith("$") && name(v.slice(1))
    ? v.slice(1)
    : undefined;
function refuse(): never {
  throw Error("Unsupported editing cell scope");
}
export const readLegacyCellWriteSites: ReadLegacyCellWriteSites = (
  source,
  visit,
  sourceAdmission="strict",
) => {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source) > MAX_COMPILED_SOURCE_BYTES
  )
    refuse();
  if(!["strict","offline-prototype"].includes(sourceAdmission))refuse();
  const text = "<>" + source + "</>";
  const tree = Parser.extend(jsx()).parseExpressionAt(text, 0, {
    ecmaVersion: "latest",
  }) as any;
  if (tree.end !== text.length) refuse();
  const out: LegacyCellWriteSite[] = [];
  const hasCellWrite = (node: any, root = true): boolean => {
    if (!node || typeof node !== "object") return false;
    if (node.type === "JSXElement") {
      const tag = node.openingElement.name.name;
      if (!root && ["DataTable", "For"].includes(tag)) return false;
      if (
        tag !== "Button" &&
        node.openingElement.attributes.some((a: any) => a.name?.name === "run")
      )
        return true;
    }
    return Object.values(node).some((value) =>
      Array.isArray(value)
        ? value.some((child) => hasCellWrite(child, false))
        : hasCellWrite(value, false),
    );
  };
  const walk = (
    node: any,
    scope?: { dataName: string; rowKey: string; column?: string },
  ) => {
    if (!node || typeof node !== "object") return;
    let next = scope;
    if (node.type === "JSXElement") {
      const tag = node.openingElement.name.name;
      const attributes = node.openingElement.attributes as any[];
      const selected = (key: string) => {
        const matches = attributes.filter((a) => a.name?.name === key);
        if (matches.length > 1) refuse();
        const attr = matches[0];
        if (!attr) return undefined;
        if (!attr.value) return true;
        return readLocalSourceLiteral(
          attr.value.type === "JSXExpressionContainer"
            ? attr.value.expression
            : attr.value,
        );
      };
      if (tag === "DataTable" && hasCellWrite(node)) {
        const dataName = ref(selected("data"));
        const rowKey = selected("rowKey");
        next = dataName && name(rowKey) ? { dataName, rowKey } : undefined;
      }
      if (tag === "For") next = undefined;
      if (tag === "DataTable" && !hasCellWrite(node)) next = undefined;
      if (tag === "Column" && hasCellWrite(node)) {
        const column = selected("col");
        next = scope && name(column) ? { ...scope, column } : undefined;
      }
      const run = selected("run");
      if (run !== undefined && tag !== "Button") {
        if (!["input", "textarea", "Select"].includes(tag) || !next?.column)
          refuse();
        const mutationName = ref(run),
          value = selected("value");
        if (!mutationName || value !== "$_row." + next.column) refuse();
        if (tag === "Select" && selected("options") === undefined) refuse();
        if (
          tag === "input" &&
          !["text", "number", "date", "datetime-local", undefined].includes(
            selected("type") as any,
          )
        )
          refuse();
        const allowed = new Set([
          "id",
          "className",
          "aria-label",
          "run",
          "value",
          "label",
          "placeholder",
          "disabled",
          ...(tag === "Select"
            ? [
                "options",
                "multiple",
                "allowCreate",
                "valueFormat",
                "nullable",
                "exclude",
              ]
            : tag === "input"
              ? ["type", "min", "max", "step"]
              : []),
        ]);
        for (const attribute of attributes) {
          // Compiler-owned presentation does not grant a mutation target or value source.
          if(sourceAdmission==="offline-prototype" && attribute.type==="JSXAttribute" && !["run","value","type","options","multiple","allowCreate","valueFormat","nullable","exclude"].includes(attribute.name?.name))continue;
          if (
            attribute.type !== "JSXAttribute" ||
            !allowed.has(attribute.name?.name)
          )
            refuse();
          const value = selected(attribute.name.name);
          if (["min","max","step"].includes(attribute.name.name) && !((typeof value==="number" && Number.isFinite(value)) || (typeof value==="string" && value.length<=128))) refuse();
          if (
            ["multiple", "allowCreate", "nullable", "disabled"].includes(
              attribute.name.name,
            ) &&
            typeof value !== "boolean"
          )
            refuse();
          if (
            [
              "id",
              "className",
              "aria-label",
              "label",
              "placeholder",
              "valueFormat",
            ].includes(attribute.name.name) &&
            (typeof value !== "string" || value.length > 4096)
          )
            refuse();
        }
        if (
          node.children.some(
            (child: any) =>
              !(child.type === "JSXText" && !child.value.trim()) &&
              !(
                child.type === "JSXExpressionContainer" &&
                child.expression.type === "JSXEmptyExpression"
              ),
          )
        )
          refuse();
        if (tag === "Select")
          admitDataControl("Select", {
            value: "$cell",
            options: selected("options"),
          });
        const optionsQuery =
          tag === "Select" ? ref(selected("options")) : undefined;
        const site: LegacyCellWriteSite = {
          mutationName,
          dataName: next.dataName,
          column: next.column,
          rowKey: next.rowKey,
          tag,
          ...(optionsQuery ? { optionsQuery } : {}),
        };
        out.push(site);
        visit?.(node, site);
        if (out.length > 256) refuse();
      }
    }
    for (const [key, value] of Object.entries(node))
      if (!["start", "end"].includes(key)) {
        if (Array.isArray(value)) value.forEach((v) => walk(v, next));
        else if (value && typeof value === "object") walk(value, next);
      }
  };
  walk(tree);
  return out;
};
export const typeLegacyCellWriteSites: TypeLegacyCellWriteSites = (
  sites,
  columns,
) => {
  const mutations = new Map<string, string>();
  return sites.map((site) => {
    const schema = columns[site.dataName];
    if (!schema) refuse();
    const fields = schema.filter((c) => c.name === site.column),
      keys = schema.filter((c) => c.name === site.rowKey);
    if (
      fields.length !== 1 ||
      keys.length !== 1 ||
      keys[0]!.type === "boolean" ||
      !["string", "number", "boolean", "date", "timestamp", "user"].includes(
        fields[0]!.type,
      )
    )
      refuse();
    const type = fields[0]!.type,
      prior = mutations.get(site.mutationName);
    if (prior !== undefined && prior !== type) refuse();
    mutations.set(site.mutationName, type);
    return { ...site, type };
  });
};
