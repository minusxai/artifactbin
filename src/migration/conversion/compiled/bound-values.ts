import { Parser } from "acorn";
import jsx from "acorn-jsx";
import {
  sourceValueDeclaration,
  readLocalSourceLiteral,
} from "./source-manifest.ts";
import { validBoundValueProof } from "./bound-value-proof.ts";
import type {
  BoundValueColumnProof,
  BoundValueCatalog,
  ReadBoundValueColumnProofs,
} from "./bound-value-contracts.ts";
import { MAX_COMPILED_SOURCE_BYTES } from "./contracts.ts";
function refuse(): never {
  throw Error("Unsupported bound Value authority");
}
function containsBound(n: any): boolean {
  if (!n || typeof n !== "object") return false;
  if (
    n.type === "JSXElement" &&
    n.openingElement.name.name === "Value" &&
    n.openingElement.attributes.some(
      (a: any) => a.type === "JSXAttribute" && a.name?.name === "source",
    )
  )
    return true;
  return Object.values(n).some((v) =>
    Array.isArray(v) ? v.some(containsBound) : containsBound(v),
  );
}
/** Source-only classification for historical service availability; never grants authority. */
export function hasLegacyBoundValueSource(source: string): boolean {
  try {
    if (
      typeof source !== "string" ||
      Buffer.byteLength(source) > MAX_COMPILED_SOURCE_BYTES
    )
      return false;
    const text = "<> " + source + " </>",
      tree = Parser.extend(jsx()).parseExpressionAt(text, 0, {
        ecmaVersion: "latest",
      }) as any;
    return tree.end === text.length && containsBound(tree);
  } catch {
    return false;
  }
}
/** Reads source literals and trusted metadata only; never source code, rows or memberships. */
export const readBoundValueColumnProofs: ReadBoundValueColumnProofs = (
  source,
  catalogs,
) => {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source) > MAX_COMPILED_SOURCE_BYTES ||
    !Array.isArray(catalogs) ||
    catalogs.length > 256
  )
    refuse();
  const text = "<> " + source + " </>",
    tree = Parser.extend(jsx()).parseExpressionAt(text, 0, {
      ecmaVersion: "latest",
    }) as any;
  if (tree.end !== text.length) refuse();
  if (!containsBound(tree)) return [];
  const imports = new Map<string, { ref: string; version?: number }>(),
    values: any[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "JSXElement") {
      const tag = n.openingElement.name.name;
      if (
        tag === "Import" ||
        (tag === "Value" &&
          n.openingElement.attributes.some(
            (a: any) => a.type === "JSXAttribute" && a.name?.name === "source",
          ))
      ) {
        if (tag === "Import") {
          const name = n.openingElement.attributes.find(
            (a: any) => a.type === "JSXAttribute" && a.name?.name === "name",
          );
          let bindingName: unknown;
          try {
            bindingName = name?.value && readLocalSourceLiteral(name.value);
          } catch {
            return;
          }
          if (!catalogs.some((c) => c.bindingName === bindingName)) return;
        }
        const attrs: Record<string, unknown> = Object.create(null);
        for (const a of n.openingElement.attributes) {
          if (a.type !== "JSXAttribute" || Object.hasOwn(attrs, a.name?.name))
            refuse();
          attrs[a.name.name] = a.value ? readLocalSourceLiteral(a.value) : true;
        }
        if (tag === "Import") {
          if (
            typeof attrs.name !== "string" ||
            typeof attrs.src !== "string" ||
            imports.has(attrs.name)
          )
            refuse();
          if (
            attrs.version !== undefined &&
            (!Number.isSafeInteger(attrs.version) || Number(attrs.version) < 1)
          )
            refuse();
          imports.set(attrs.name, {
            ref: attrs.src,
            ...(attrs.version === undefined
              ? {}
              : { version: Number(attrs.version) }),
          });
        } else if (Object.hasOwn(attrs, "source"))
          values.push({ node: n, attrs });
      }
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(tree);
  if (values.length > 256) refuse();
  const proofs: BoundValueColumnProof[] = [],
    names = new Set<string>();
  for (const { node, attrs } of values) {
    const selected = (catalogs as readonly BoundValueCatalog[]).filter(
      (c) =>
        c.sourceRef === attrs.source &&
        imports.get(c.bindingName)?.ref === c.sourceRef &&
        (imports.get(c.bindingName)?.version === undefined ||
          imports.get(c.bindingName)?.version === c.version),
    );
    if (selected.length !== 1) refuse();
    const catalog = selected[0]!;
    const tables = catalog.tables.filter(
      (t) =>
        t.name === "rows" && t.columns.some((c) => c.name === attrs.column),
    );
    if (tables.length !== 1) refuse();
    const table = tables[0]!,
      columns = table.columns.filter((c) => c.name === attrs.column);
    if (columns.length !== 1) refuse();
    const column = columns[0]!;
    const proof = {
      valueName: attrs.name,
      sourceRef: attrs.source,
      version: catalog.version,
      bindingName: catalog.bindingName,
      schema: table.schema,
      table: "rows",
      column: column.name,
      type: column.type,
      ...(column.constraints === undefined
        ? {}
        : { constraints: structuredClone(column.constraints) }),
    };
    if (!validBoundValueProof(proof) || names.has(proof.valueName)) refuse();
    sourceValueDeclaration(node, [proof]);
    names.add(proof.valueName);
    proofs.push(proof);
  }
  return proofs;
};
