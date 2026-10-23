import { createHash } from "node:crypto";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import type { DatasetBrowserBinding } from "../datasets/planner-contracts.ts";
import type {
  LegacyColumnAliasAdmission,
  LegacyColumnAliasReceipt,
} from "./column-alias-contracts.ts";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
/** Only exact audited source/query/schema matches receive a projected read alias.
 * Mutations, row identities, dataset storage and the archived original are untouched. */
export function repairLegacyColumnAliases(
  source: string,
  bindings: readonly DatasetBrowserBinding[],
  admissions: readonly LegacyColumnAliasAdmission[] = [],
): { source: string; receipts: LegacyColumnAliasReceipt[] } {
  const matches = admissions.filter(
    (a) => a.version === "column-alias-v1" && a.sourceSha256 === hash(source),
  );
  if (!matches.length) return { source, receipts: [] };
  if (matches.length !== 1) throw Error("Ambiguous column alias admission");
  const a = matches[0]!;
  if (
    ![a.from, a.to, a.queryName, a.bindingName].every((n) =>
      /^[_A-Za-z][_A-Za-z0-9]*$/.test(n),
    ) ||
    a.from === a.to
  )
    throw Error("Invalid column alias admission");
  const binding = bindings.find(
    (b) =>
      b.name === a.bindingName &&
      b.legacyRef === a.legacyRef &&
      b.version === a.datasetVersion,
  );
  const table = binding?.tables.find(
    (t) => t.schema === "public" && t.table === "rows",
  );
  if (
    !table ||
    hash(JSON.stringify(table)) !== a.tableSha256 ||
    table.columns.some((c) => c.name === a.from) ||
    table.columns.find((c) => c.name === a.to)?.type !== "string"
  )
    throw Error("Column alias trusted schema changed");
  const text = "<>" + source + "</>",
    tree = Parser.extend(jsx()).parseExpressionAt(text, 0, {
      ecmaVersion: "latest",
    }) as any;
  const edits: { start: number; end: number; text: string }[] = [];
  function walk(n: any): void {
    if (!n || typeof n !== "object") return;
    if (n.type === "JSXElement" && n.openingElement.name.name === "Query") {
      const attrs = n.openingElement.attributes,
        name = attrs.find((x: any) => x.name?.name === "name")?.value?.value;
      if (name === a.queryName) {
        const expr = n.children.find(
          (c: any) => c.expression?.type === "TemplateLiteral",
        )?.expression;
        const sql = expr?.quasis[0]?.value.cooked;
        if (
          !expr ||
          expr.expressions.length ||
          typeof sql !== "string" ||
          hash(sql) !== a.querySha256
        )
          throw Error("Column alias original query changed");
        const projection =
          /^(\s*select\s+)\*(\s+from\s+([_A-Za-z][_A-Za-z0-9]*)\.rows\b)/i.exec(
            sql,
          );
        if (!projection || projection[3] !== a.bindingName)
          throw Error("Unsupported column alias projection");
        const patched =
          sql.slice(0, projection[1]!.length) +
          `*, "${a.to}" AS "${a.from}"` +
          sql.slice(projection[1]!.length + 1);
        edits.push({
          start: expr.start,
          end: expr.end,
          text:
            "`" +
            patched
              .replace(/\\/g, "\\\\")
              .replace(/`/g, "\\`")
              .replace(/\$\{/g, "\\${") +
            "`",
        });
      }
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === "start" || k === "end") continue;
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  }
  walk(tree);
  if (edits.length !== 1)
    throw Error("Column alias query unavailable or ambiguous");
  const edit = edits[0]!,
    repaired = (
      text.slice(0, edit.start) +
      edit.text +
      text.slice(edit.end)
    ).slice(2, -3);
  return {
    source: repaired,
    receipts: [
      {
        version: "column-alias-v1",
        admissionSha256: hash(JSON.stringify(a)),
        originalSourceSha256: hash(source),
        repairedSourceSha256: hash(repaired),
        inference: "audited-column-rename",
      },
    ],
  };
}
