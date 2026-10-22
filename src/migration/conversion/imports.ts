/** Offline-only dependency discovery. Parsing never evaluates source. */
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import type { LegacyImportExtraction } from "./import-contracts.ts";
import { MAX_COMPILED_SOURCE_BYTES } from "./compiled/contracts.ts";
export type * from "./import-contracts.ts";
export function extractLegacyImports(source: string): LegacyImportExtraction {
  const result: LegacyImportExtraction = { imports: [], issues: [] };
  const issue = (code: string) =>
    result.issues.push({
      code,
      message:
        "Import dependencies require explicit literal declarations and trusted dataset version lookup",
      path: "root",
    });
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source) > MAX_COMPILED_SOURCE_BYTES
  ) {
    issue("import-source-limit");
    return result;
  }
  try {
    const text = "<> " + source + " </>";
    const tree = Parser.extend(jsx()).parseExpressionAt(text, 0, {
      ecmaVersion: "latest",
    }) as any;
    if (tree.end !== text.length) throw Error();
    const names = new Set<string>();
    const literal = (attr: any): unknown =>
      attr?.value?.type === "Literal"
        ? attr.value.value
        : attr?.value?.expression?.type === "Literal"
          ? attr.value.expression.value
          : undefined;
    const walk = (node: any, parentTag?: string) => {
      let nextParent = parentTag;
      if (node.type === "JSXElement") {
        const tag = node.openingElement.name.name;
        nextParent = tag;
        if (tag === "Import") {
          const attrs = node.openingElement.attributes;
          const name = literal(attrs.find((a: any) => a.name?.name === "name"));
          const legacyRef = literal(
            attrs.find((a: any) => a.name?.name === "src"),
          );
          const id =
            typeof legacyRef === "string"
              ? /^ref:([A-Za-z0-9]{6,12})$/.exec(legacyRef)?.[1]
              : undefined;
          if (
            parentTag !== "Helmet" ||
            attrs.length !== 2 ||
            attrs.some(
              (a: any) =>
                a.type !== "JSXAttribute" ||
                !["name", "src"].includes(a.name?.name),
            ) ||
            typeof name !== "string" ||
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ||
            ["constructor", "prototype", "__proto__"].includes(name) ||
            names.has(name.toLowerCase()) ||
            !id ||
            node.children.some(
              (c: any) => c.type !== "JSXText" || c.value.trim(),
            )
          )
            issue("import-declaration");
          else {
            names.add(name.toLowerCase());
            result.imports.push({
              name,
              legacyRef: legacyRef as string,
              datasetLegacyId: id,
            });
          }
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (["start", "end"].includes(key)) continue;
        if (Array.isArray(value))
          value.forEach((v) => {
            if (v && typeof v === "object") walk(v, nextParent);
          });
        else if (value && typeof value === "object") walk(value, nextParent);
      }
    };
    walk(tree);
    if (result.imports.length > 16) issue("import-count-limit");
  } catch {
    issue("import-source");
  }
  if (result.issues.length) result.imports = [];
  return result;
}
