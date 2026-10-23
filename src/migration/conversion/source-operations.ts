import { normalizeLegacyDuckSql } from "./duck-sql.ts";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import type { LegacySourceOperationNormalization } from "./source-operation-contracts.ts";
function rewriteSql(sql: string, alias: string): string {
  let out = "",
    i = 0,
    count = 0;
  while (i < sql.length) {
    const start = i,
      c = sql[i]!;
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] === q) {
          if (sql[i] === q) {
            i++;
            continue;
          }
          closed = true;
          break;
        }
      }
      if (!closed) throw Error("Unclosed source SQL quote");
      out += sql.slice(start, i);
      continue;
    }
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      out += sql.slice(start, i);
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) throw Error("Unclosed source SQL comment");
      i = end + 2;
      out += sql.slice(start, i);
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i));
    if (word) {
      const table = /^public\s*\.\s*rows\b/i.exec(sql.slice(i));
      if (table && word[0].toLowerCase() === "public") {
        out += alias + ".rows";
        i += table[0].length;
        count++;
      } else {
        out += word[0];
        i += word[0].length;
      }
    } else {
      out += c;
      i++;
    }
  }
  if (!count)
    throw Error("Source operation requires the verified public.rows table");
  return out;
}
/** Migration-only syntax lowering. Eligible refs come from verified stored catalogs, never guessed URLs. */
export function normalizeLegacySourceOperations(
  source: string,
  eligibleRefs: readonly string[],
  admissions: readonly import("./duck-sql-contracts.ts").LegacyDuckSqlAdmission[] = [],
): LegacySourceOperationNormalization {
  const empty = {
    source,
    imports: [],
    operations: [],
  } satisfies LegacySourceOperationNormalization;
  if (!source.includes("source") || !eligibleRefs.length) return empty;
  const text = "<>" + source + "</>",
    tree = Parser.extend(jsx()).parseExpressionAt(text, 0, {
      ecmaVersion: "latest",
    }) as any;
  if (tree.end !== text.length) throw Error("Incomplete source operations");
  const names = new Set<string>(),
    sites: any[] = [],
    sqlSites: any[] = [],
    helmets: any[] = [];
  const literal = (a: any) =>
    a?.value?.type === "Literal"
      ? a.value.value
      : a?.value?.expression?.type === "Literal"
        ? a.value.expression.value
        : undefined;
  function walk(n: any, parent?: any): void {
    if (!n || typeof n !== "object") return;
    if (n.type === "JSXElement") {
      const tag = n.openingElement.name.name,
        attrs = n.openingElement.attributes;
      for (const a of attrs)
        if (a.name?.name === "name" && typeof literal(a) === "string")
          names.add(literal(a).toLowerCase());
      if (tag === "Helmet") helmets.push(n);
      if (["Query", "Mutation"].includes(tag)) {
        const children = n.children.filter(
          (c: any) => c.type !== "JSXText" || c.value.trim(),
        );
        const expr = children[0]?.expression;
        if (
          children.length === 1 &&
          expr?.type === "TemplateLiteral" &&
          !expr.expressions.length &&
          typeof expr.quasis[0]?.value.cooked === "string"
        )
          sqlSites.push({ expr, sql: expr.quasis[0].value.cooked });
      }

      const attr = attrs.find((a: any) => a.name?.name === "source"),
        ref = literal(attr);
      if (["Query", "Mutation"].includes(tag) && eligibleRefs.includes(ref)) {
        if (
          parent?.openingElement?.name?.name !== "Helmet" ||
          attrs.some((a: any) => a.type !== "JSXAttribute") ||
          attrs.filter((a: any) => a.name?.name === "source").length !== 1
        )
          throw Error("Invalid source operation placement");
        const name = literal(attrs.find((a: any) => a.name?.name === "name"));
        if (typeof name !== "string" || !/^[_A-Za-z][_A-Za-z0-9]*$/.test(name))
          throw Error("Invalid source operation name");
        const children = n.children.filter(
          (c: any) => c.type !== "JSXText" || c.value.trim(),
        );
        const expr = children[0]?.expression;
        if (
          children.length !== 1 ||
          expr?.type !== "TemplateLiteral" ||
          expr.expressions.length ||
          typeof expr.quasis[0]?.value.cooked !== "string"
        )
          throw Error("Literal source SQL required");
        sites.push({
          tag,
          name,
          ref,
          attr,
          expr,
          sql: expr.quasis[0].value.cooked,
          helmet: parent,
        });
      }
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === "start" || k === "end") continue;
      if (Array.isArray(v)) for (const child of v) walk(child, n);
      else if (v && typeof v === "object") walk(v, n);
    }
  }
  walk(tree);
  if (!sites.length) return empty;
  const selectedHelmet = sites[0].helmet;
  if (sites.some((s) => s.helmet !== selectedHelmet) || helmets.length !== 1)
    throw Error("Ambiguous source operations");
  const refs = [...new Set<string>(sites.map((s) => s.ref))].sort(),
    imports: { name: string; legacyRef: string }[] = [];
  for (const ref of refs) {
    let i = imports.length,
      name = "legacySource" + i;
    while (names.has(name.toLowerCase())) name = "legacySource" + ++i;
    names.add(name.toLowerCase());
    imports.push({ name, legacyRef: ref });
  }
  const edits: { start: number; end: number; text: string }[] = [];
  for (const site of sites)
    edits.push({ start: site.attr.start, end: site.attr.end, text: "" });
  for (const site of sqlSites) {
    const sourceSite = sites.find((s) => s.expr === site.expr);
    const dialect = normalizeLegacyDuckSql(site.sql, admissions).sql;
    const sql = sourceSite
      ? rewriteSql(
          dialect,
          imports.find((i) => i.legacyRef === sourceSite.ref)!.name,
        )
      : dialect;
    if (sql !== site.sql)
      edits.push({
        start: site.expr.start,
        end: site.expr.end,
        text:
          "`" +
          sql
            .replace(/\\/g, "\\\\")
            .replace(/`/g, "\\`")
            .replace(/\$\{/g, "\\${") +
          "`",
      });
  }

  edits.push({
    start: selectedHelmet.openingElement.end,
    end: selectedHelmet.openingElement.end,
    text: imports
      .map((i) => `<Import name="${i.name}" src="${i.legacyRef}"/>`)
      .join(""),
  });
  let rewritten = text;
  for (const e of edits.sort((a, b) => b.start - a.start))
    rewritten = rewritten.slice(0, e.start) + e.text + rewritten.slice(e.end);
  return {
    source: rewritten.slice(2, -3),
    imports,
    operations: sites.map((s) => ({
      name: s.name,
      kind: s.tag,
      legacyRef: s.ref,
    })),
  };
}

/** Discovery only: callers independently verify every returned dataset catalog. */
export function legacySourceOperationRefs(source: string): string[] {
  const tree = Parser.extend(jsx()).parseExpressionAt(
      "<>" + source + "</>",
      0,
      { ecmaVersion: "latest" },
    ) as any,
    refs = new Set<string>();
  function walk(n: any): void {
    if (!n || typeof n !== "object") return;
    if (
      n.type === "JSXElement" &&
      ["Query", "Mutation"].includes(n.openingElement.name.name)
    )
      for (const a of n.openingElement.attributes) {
        const ref = a.value?.value ?? a.value?.expression?.value;
        if (
          a.name?.name === "source" &&
          typeof ref === "string" &&
          /^ref:[A-Za-z0-9]{6,12}$/.test(ref)
        )
          refs.add(ref);
      }
    for (const [k, v] of Object.entries(n)) {
      if (k === "start" || k === "end") continue;
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  }
  walk(tree);
  return [...refs];
}
