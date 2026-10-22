import { createHash } from "node:crypto";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { readLocalSourceLiteral } from "./source-manifest.ts";
import type { LegacySourceQuerySite } from "./source-query-contracts.ts";
/** Discovery only. The archived compiler validates declaration placement and complete dataflow semantics. */
export function readLegacySourceQuerySites(
  source: string,
): LegacySourceQuerySite[] {
  const tree: any = Parser.extend(jsx()).parse("<>" + source + "</>", {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const sites: LegacySourceQuerySite[] = [];
  const visit = (n: any, parent?: string) => {
    if (!n || typeof n !== "object") return;
    let next = parent;
    if (n.type === "JSXElement") {
      const tag = n.openingElement.name.name;
      next = tag;
      if (tag === "Query" && parent === "Helmet") {
        const attrs: Record<string, unknown> = Object.create(null);
        for (const a of n.openingElement.attributes) {
          if (a.type !== "JSXAttribute" || Object.hasOwn(attrs, a.name.name))
            throw Error("Invalid source query declaration");
          attrs[a.name.name] = readLocalSourceLiteral(a.value);
        }
        if (attrs.source !== undefined) {
          const children = n.children.filter(
            (c: any) => c.type !== "JSXText" || c.value.trim(),
          );
          const sql =
            children.length === 1 ? readLocalSourceLiteral(children[0]) : null;
          if (
            Object.keys(attrs).some((k) => !["name", "source"].includes(k)) ||
            typeof attrs.name !== "string" ||
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(attrs.name) ||
            typeof attrs.source !== "string" ||
            !/^ref:[A-Za-z0-9]{6,12}$/.test(attrs.source) ||
            typeof sql !== "string" ||
            !sql.trim()
          )
            throw Error("Invalid source query declaration");
          sites.push({
            name: attrs.name,
            sourceRef: attrs.source,
            sql,
            sqlSha256: createHash("sha256").update(sql).digest("hex"),
          });
        }
      }
    }
    for (const value of Object.values(n)) {
      if (Array.isArray(value)) for (const child of value) visit(child, next);
      else if (value && typeof value === "object") visit(value, next);
    }
  };
  visit(tree);
  if (
    sites.length > 128 ||
    new Set(sites.map((s) => s.name)).size !== sites.length
  )
    throw Error("Invalid source query declarations");
  return sites;
}
