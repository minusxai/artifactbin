import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { SqliteDatabase } from "../../../datasets/sql/engine/database.ts";
import { loadSqliteModule } from "../../../datasets/sql/engine/wasm.ts";
import type { LegacyMutationImportCatalog } from "../mutation-contracts.ts";
import {
  readLocalSourceLiteral,
  sourceValueDeclaration,
} from "./source-manifest.ts";
import { MAX_COMPILED_SOURCE_BYTES } from "./contracts.ts";
/** Offline SQL preparation, never execution: an identifier inside a comment,
 * string, column alias or shadowing CTE is not the physical members relation. */
async function analyzeLegacyMembers(
  source: string,
  catalogs: readonly LegacyMutationImportCatalog[] = [],
): Promise<boolean> {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source) > MAX_COMPILED_SOURCE_BYTES
  )
    throw Error("Unsupported member query source");
  const text = "<> " + source + " </>",
    tree = Parser.extend(jsx()).parseExpressionAt(text, 0, {
      ecmaVersion: "latest",
    }) as any;
  if (tree.end !== text.length) throw Error("Unsupported member query source");
  const queries: { name: string; sql: string }[] = [],
    imports = new Map<string, string>(),
    tables: any[] = [];
  const attrs = (n: any) => {
    const out: Record<string, unknown> = Object.create(null);
    for (const a of n.openingElement.attributes) {
      if (a.type !== "JSXAttribute" || Object.hasOwn(out, a.name?.name))
        throw Error("Unsupported member query source");
      if (["name", "src"].includes(a.name.name))
        out[a.name.name] = readLocalSourceLiteral(a.value);
    }
    return out;
  };
  const walk = (n: any, parent?: string) => {
    if (!n || typeof n !== "object") return;
    let next = parent;
    if (n.type === "JSXElement") {
      const tag = n.openingElement.name.name;
      next = tag;
      if (parent === "Helmet" && ["Query", "Import", "Value"].includes(tag)) {
        if (tag === "Value") {
          const t = n.openingElement.attributes.find(
            (a: any) => a.name?.name === "type",
          );
          if (t && readLocalSourceLiteral(t.value) === "table") tables.push(n);
        } else {
          const a = attrs(n);
          if (
            typeof a.name !== "string" ||
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(a.name)
          )
            throw Error("Unsupported member query source");
          if (tag === "Import") {
            if (typeof a.src !== "string" || imports.has(a.name))
              throw Error("Unsupported member query source");
            imports.set(a.name, a.src);
          } else {
            const children = n.children.filter(
              (c: any) => c.type !== "JSXText" || c.value.trim(),
            );
            if (
              children.length !== 1 ||
              children[0].type !== "JSXExpressionContainer"
            )
              throw Error("Unsupported member query source");
            const sql = readLocalSourceLiteral(children[0]);
            if (typeof sql !== "string")
              throw Error("Unsupported member query source");
            queries.push({ name: a.name, sql });
          }
        }
      }
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach((v) => walk(v, next));
      else if (v && typeof v === "object") walk(v, next);
    }
  };
  walk(tree);
  if (!queries.some((q) => q.sql.toLowerCase().includes("_members")))
    return false;
  if (queries.length > 128) throw Error("Unsupported member query source");
  const db = new SqliteDatabase(await loadSqliteModule());
  try {
    db.createTable({
      schema: "main",
      table: "_members",
      columns: [
        { name: "user_id", type: "user" },
        { name: "joined_at", type: "timestamp" },
      ],
    });
    db.createTable({
      schema: "main",
      table: "_me",
      columns: [{ name: "id", type: "user" }],
    });
    for (const node of tables) {
      let table;
      try {
        table = sourceValueDeclaration(node);
      } catch {
        continue;
      }
      if (table.type !== "table") continue;
      db.createTable({
        schema: "main",
        table: table.name,
        columns: table.columns,
      });
    }
    for (const catalog of catalogs) {
      if (imports.get(catalog.name) !== `ref:${catalog.datasetLegacyId}`)
        continue;
      for (const table of catalog.tables)
        db.createTable({
          schema: catalog.name,
          table: table.name,
          columns: [...table.columns],
        });
    }
    let pending = [...queries];
    while (pending.length) {
      const next: typeof pending = [];
      let progressed = false;
      for (const query of pending) {
        let prepared;
        try {
          prepared = db.prepare(query.sql, "read");
        } catch {
          next.push(query);
          continue;
        }
        try {
          const a = prepared.analysis;
          if (
            a.reads.some(
              (r) =>
                r.schema.toLowerCase() === "main" &&
                r.table.toLowerCase() === "_members",
            )
          )
            return true;
          db.createTable({
            schema: "main",
            table: query.name,
            columns: a.columns.map((c) => ({
              name: c.name,
              type: c.declaredType ?? "string",
            })),
          });
          progressed = true;
        } finally {
          prepared.finalize();
        }
      }
      if (!progressed) return false;
      pending = next;
    }
    return false;
  } finally {
    db.close();
  }
}

/** Detection cannot turn an unrelated source refusal into new import authority. */
export async function readsLegacyMembers(
  source: string,
  catalogs: readonly LegacyMutationImportCatalog[] = [],
): Promise<boolean> {
  try {
    return await analyzeLegacyMembers(source, catalogs);
  } catch {
    return false;
  }
}
