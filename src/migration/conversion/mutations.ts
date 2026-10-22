/** Offline-only publication analysis. Source is parsed, SQL is prepared, neither is evaluated. */
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { SqliteDatabase } from "../../datasets/sql/engine/database.ts";
import { loadSqliteModule } from "../../datasets/sql/engine/wasm.ts";
import { MAX_COMPILED_SOURCE_BYTES } from "./compiled/contracts.ts";
import type {
  LegacyMutationExtraction,
  LegacyMutationImportCatalog,
} from "./mutation-contracts.ts";
export type * from "./mutation-contracts.ts";
const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
const reserved = new Set(["constructor", "prototype", "__proto__"]);
const types = new Set([
  "number",
  "string",
  "boolean",
  "date",
  "timestamp",
  "user",
]);
const literal = (node: any): unknown =>
  node?.type === "Literal"
    ? node.value
    : node?.type === "TemplateLiteral" && node.expressions.length === 0
      ? node.quasis[0]?.value.cooked
      : undefined;
/** Only builtin tokens outside SQL strings, identifiers and comments are rewritten. */
function builtinSql(text: string): { sql: string; nowLiteral: boolean } {
  let out = "",
    i = 0,
    nowLiteral = false;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      const start = i++;
      while (i < text.length) {
        if (text[i++] === close) {
          if (text[i] === close) i++;
          else break;
        }
      }
      if (
        c === "'" &&
        text
          .slice(start + 1, i - 1)
          .replaceAll("''", "'")
          .toLowerCase() === "now"
      )
        nowLiteral = true;
      out += text.slice(start, i);
    } else if (text.startsWith("--", i) || text.startsWith("/*", i)) {
      const line = text.startsWith("--", i);
      const end = text.indexOf(line ? "\n" : "*/", i + 2);
      const next = end < 0 ? text.length : end + (line ? 1 : 2);
      out += text.slice(i, next);
      i = next;
    } else if (c === "$") {
      const field = /^\$(_[A-Za-z]\w*)\.([A-Za-z_]\w*)/.exec(text.slice(i));
      if (field) {
        if (field[1] !== "_me" || field[2] !== "id")
          throw Error("unsupported builtin");
        out += "$_me__id";
        i += field[0].length;
      } else {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return { sql: out, nowLiteral };
}
export async function extractLegacyMutations(
  source: string,
  catalogs: readonly LegacyMutationImportCatalog[],
): Promise<LegacyMutationExtraction> {
  const result: LegacyMutationExtraction = { mutations: [], issues: [] };
  const issue = () =>
    result.issues.push({
      code: "mutation-publication",
      message:
        "Persistent mutations require literal declarations, one verified imported table and declared scalar parameters",
      path: "root",
    });
  let db: SqliteDatabase | undefined;
  try {
    if (
      typeof source !== "string" ||
      Buffer.byteLength(source) > MAX_COMPILED_SOURCE_BYTES
    )
      throw Error();
    const text = "<> " + source + " </>";
    const tree = Parser.extend(jsx()).parseExpressionAt(text, 0, {
      ecmaVersion: "latest",
    }) as any;
    if (tree.end !== text.length) throw Error();
    const declarations: any[] = [],
      params = new Map<string, any>(),
      importNames = new Map<string, string>();
    const attrsOf = (node: any) => {
      const values = new Map<string, unknown>();
      for (const a of node.openingElement.attributes) {
        if (a.type !== "JSXAttribute" || values.has(a.name.name)) throw Error();
        const value =
          a.value?.type === "JSXExpressionContainer"
            ? literal(a.value.expression)
            : literal(a.value);
        values.set(a.name.name, value);
      }
      return values;
    };
    const walk = (node: any, parent?: string) => {
      let next = parent;
      if (node.type === "JSXElement") {
        const tag = node.openingElement.name.name;
        next = tag;
        if (["Import", "Value", "Mutation"].includes(tag)) {
          const a = attrsOf(node),
            name = a.get("name");
          if (
            parent !== "Helmet" ||
            typeof name !== "string" ||
            !identifier.test(name) ||
            name.length > 128 ||
            reserved.has(name)
          )
            throw Error();
          if (tag === "Import") {
            const src = a.get("src");
            if (
              typeof src !== "string" ||
              !/^ref:[A-Za-z0-9]{6,12}$/.test(src) ||
              importNames.has(name.toLowerCase())
            )
              throw Error();
            importNames.set(name.toLowerCase(), src.slice(4));
          } else if (tag === "Value") {
            const type = a.get("type");
            if (params.has(name) || typeof type !== "string") throw Error();
            // Table Values remain browser-local; never become server SQL bindings.
            params.set(name, types.has(type) ? type : null);
          } else {
            if (
              [...a.keys()].some(
                (k) => !["name", "expectedAffected", "reset"].includes(k),
              )
            )
              throw Error();
            const children = node.children.filter(
              (c: any) => c.type !== "JSXText" || c.value.trim(),
            );
            if (
              children.length !== 1 ||
              children[0].type !== "JSXExpressionContainer"
            )
              throw Error();
            const sql = literal(children[0].expression),
              expected = a.get("expectedAffected");
            if (
              typeof sql !== "string" ||
              sql.length > 64000 ||
              (a.has("expectedAffected") &&
                (!Number.isSafeInteger(expected) || (expected as number) < 0))
            )
              throw Error();
            // Reset is viewer state, retained by the browser interpreter, never an authority input.
            declarations.push({ name, ...builtinSql(sql), expected });
          }
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (["start", "end"].includes(key)) continue;
        if (Array.isArray(value))
          value.forEach((v) => {
            if (v && typeof v === "object") walk(v, next);
          });
        else if (value && typeof value === "object") walk(value, next);
      }
    };
    walk(tree);
    if (!declarations.length) return result;
    if (declarations.length > 128) throw Error();
    const catalogByAlias = new Map<string, LegacyMutationImportCatalog>();
    db = new SqliteDatabase(await loadSqliteModule());
    for (const catalog of catalogs) {
      const alias = catalog.name.toLowerCase();
      // Only source-declared Imports may grant a catalog namespace.
      if (importNames.get(alias) !== catalog.datasetLegacyId) continue;
      if (catalogByAlias.has(alias)) throw Error();
      catalogByAlias.set(alias, catalog);
      const names = new Set<string>();
      for (const table of catalog.tables) {
        if (names.has(table.name.toLowerCase())) throw Error();
        names.add(table.name.toLowerCase());
        db.createTable({
          schema: catalog.name,
          table: table.name,
          columns: [...table.columns],
        });
      }
    }
    const names = new Set<string>();
    for (const d of declarations) {
      if (names.has(d.name.toLowerCase())) throw Error();
      names.add(d.name.toLowerCase());
      const prepared = db.prepare(d.sql, "any");
      try {
        const a = prepared.analysis;
        if (
          d.nowLiteral &&
          a.functions.some((name) =>
            [
              "date",
              "time",
              "datetime",
              "julianday",
              "strftime",
              "unixepoch",
              "timediff",
            ].includes(name),
          )
        )
          throw Error("unbound clock");
        if (a.kind === "select" || a.writes.length !== 1) throw Error();
        const w = a.writes[0]!,
          catalog = catalogByAlias.get(w.schema.toLowerCase());
        const table = catalog?.tables.find(
          (t) => t.name.toLowerCase() === w.table.toLowerCase(),
        );
        if (
          !catalog ||
          !table ||
          a.reads.some(
            (r) =>
              r.schema.toLowerCase() !== w.schema.toLowerCase() ||
              r.table.toLowerCase() !== w.table.toLowerCase(),
          )
        )
          throw Error();
        const paramTypes: Record<string, any> = {};
        for (const p of a.params) {
          if (p === "_me__id" || p === "_now") continue;
          if (!identifier.test(p) || reserved.has(p) || !params.get(p))
            throw Error();
          paramTypes[p] = params.get(p);
        }
        result.mutations.push({
          name: d.name,
          bindingName: catalog.name,
          datasetLegacyId: catalog.datasetLegacyId,
          target: { schema: table.schema, table: table.name },
          sqlSchema: catalog.name,
          sql: d.sql,
          paramTypes,
          ...(d.expected !== undefined ? { expectedAffected: d.expected } : {}),
          conflictMode: "refuse",
        });
      } finally {
        prepared.finalize();
      }
    }
  } catch {
    issue();
  } finally {
    db?.close();
  }
  if (result.issues.length) result.mutations = [];
  return result;
}
