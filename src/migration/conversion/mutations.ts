/** Offline-only publication analysis. Source is parsed, SQL is prepared, neither is evaluated. */
import { legacyCellWriteQueryColumns } from "./cell-write-query-columns.ts";
import {
  readLegacyCellWriteSites,
  typeLegacyCellWriteSites,
} from "./compiled/cell-write-source.ts";
import type { LegacyCellWriteQuery } from "./cell-write-query-contracts.ts";
import type { BoundValueColumnProof } from "./compiled/bound-value-contracts.ts";
import { validBoundValueProof } from "./compiled/bound-value-proof.ts";
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
function builtinSql(text: string): {
  sql: string;
  nowLiteral: boolean;
  cellValue: boolean;
  rowFields: string[];
  ordinaryParams: string[];
} {
  const rowFields = new Set<string>(),
    ordinaryParams = new Set<string>();
  let out = "",
    i = 0,
    nowLiteral = false,
    cellValue = false;
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
        if (
          field[1] === "_row" &&
          identifier.test(field[2]!) &&
          !reserved.has(field[2]!) &&
          field[2]!.length <= 123
        ) {
          rowFields.add(field[2]!);
          out += "$row__" + field[2];
        } else if (field[1] === "_me" && field[2] === "id") out += "$_me__id";
        else throw Error("unsupported builtin");
        if (text[i + field[0].length] === ".") throw Error("nested builtin");
        i += field[0].length;
      } else {
        const param = /^\$([A-Za-z_]\w*)/.exec(text.slice(i));
        if (param?.[1] === "_value") {
          if (text[i + param[0].length] === ".")
            throw Error("nested cell builtin");
          cellValue = true;
          out += "$cell__value";
          i += param[0].length;
        } else {
          if (param) ordinaryParams.add(param[1]!);
          out += c;
          i++;
        }
      }
    } else {
      out += c;
      i++;
    }
  }
  return {
    sql: out,
    nowLiteral,
    cellValue,
    rowFields: [...rowFields],
    ordinaryParams: [...ordinaryParams],
  };
}
export async function extractLegacyMutations(
  source: string,
  catalogs: readonly LegacyMutationImportCatalog[],
  boundValueColumns: readonly BoundValueColumnProof[] = [],
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
    const containsMutation = (node: any): boolean => {
      if (!node || typeof node !== "object") return false;
      if (
        node.type === "JSXElement" &&
        node.openingElement.name.type === "JSXIdentifier" &&
        node.openingElement.name.name === "Mutation"
      )
        return true;
      return Object.entries(node).some(
        ([key, value]) =>
          !["start", "end"].includes(key) &&
          (Array.isArray(value)
            ? value.some(containsMutation)
            : containsMutation(value)),
      );
    };
    // Read-only pages retain their existing admission; mutation restrictions apply only to actual declarations.
    if (!containsMutation(tree)) return result;
    const queryNodes: any[] = [];
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
        if (tag === "Query") queryNodes.push({ node, parent });
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
            if (["main", "temp"].includes(name.toLowerCase()))
              throw Error("local SQL namespace");
            const src = a.get("src");
            if (
              typeof src !== "string" ||
              !/^ref:[A-Za-z0-9]{6,12}$/.test(src) ||
              importNames.has(name.toLowerCase())
            )
              throw Error();
            importNames.set(name.toLowerCase(), src.slice(4));
          } else if (tag === "Value") {
            let type = a.get("type");
            if (a.has("source")) {
              if (a.has("type") || a.has("constraints")) throw Error();
              const proofs = boundValueColumns.filter((p) => p.valueName === name);
              if (proofs.length !== 1) throw Error();
              const proof = proofs[0]!;
              if (!validBoundValueProof(proof) || proof.sourceRef !== a.get("source") || proof.column !== a.get("column")) throw Error();
              const matches = catalogs.filter((c) => c.name === proof.bindingName && `ref:${c.datasetLegacyId}` === proof.sourceRef);
              if (matches.length !== 1 || !matches[0]!.tables.some((t) => t.schema === proof.schema && t.name === proof.table && t.columns.some((c) => c.name === proof.column && c.type === "user"))) throw Error();
              type = "user";
            }
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
            const resetValue = a.get("reset");
            if (a.has("reset") && typeof resetValue !== "string")
              throw Error("invalid reset declaration");
            const reset =
              typeof resetValue === "string"
                ? resetValue.trim().split(/\s+/).filter(Boolean)
                : [];
            declarations.push({
              reset,
              name,
              ...builtinSql(sql),
              expected,
            });
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
    db.createTable({
      schema: "main",
      table: "_members",
      columns: [
        { name: "user_id", type: "user" },
        { name: "joined_at", type: "timestamp" },
      ],
    });
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
    const cellTypes = new Map<
      string,
      import("../../datasets/contracts.ts").DatasetColumn["type"]
    >();
    if (declarations.some((d) => d.cellValue)) {
      const queries: LegacyCellWriteQuery[] = queryNodes.map(
        ({ node, parent }) => {
          const attrs = attrsOf(node),
            name = attrs.get("name");
          const children = node.children.filter(
            (c: any) => c.type !== "JSXText" || c.value.trim(),
          );
          const sql =
            children.length === 1 &&
            children[0].type === "JSXExpressionContainer"
              ? literal(children[0].expression)
              : undefined;
          if (
            parent !== "Helmet" ||
            [...attrs.keys()].some((k) => k !== "name") ||
            typeof name !== "string" ||
            typeof sql !== "string"
          )
            throw Error("Unsupported cell query");
          return { name, sql: builtinSql(sql).sql };
        },
      );
      const typed = typeLegacyCellWriteSites(
        readLegacyCellWriteSites(source),
        legacyCellWriteQueryColumns(db, queries),
      );
      for (const site of typed) cellTypes.set(site.mutationName, site.type);
    }
    const names = new Set<string>();
    for (const d of declarations) {
      if (names.has(d.name.toLowerCase())) throw Error();
      names.add(d.name.toLowerCase());
      if (
        d.cellValue &&
        (!cellTypes.has(d.name) ||
          params.has("cell__value") ||
          d.ordinaryParams.includes("cell__value"))
      )
        throw Error("Cell parameter collision or unknown type");
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
              !(r.schema === "main" && r.table === "_members") &&
              (r.schema.toLowerCase() !== w.schema.toLowerCase() ||
                r.table.toLowerCase() !== w.table.toLowerCase()),
          )
        )
          throw Error();
        if (d.reset.some((name: string) => !params.get(name)))
          throw Error("reset requires declared scalar");
        const paramTypes: Record<string, any> = {};
        const rowParams: Record<string, { param: string; type: null }> = {};
        for (const field of d.rowFields as string[]) {
          const param = "row__" + field;
          if (params.has(param) || d.ordinaryParams.includes(param))
            throw Error("row parameter collision");
          rowParams[field] = { param, type: null };
        }
        const rowKeys = new Set(Object.values(rowParams).map((r) => r.param));
        for (const p of a.params) {
          if (p === "_me__id" || p === "_now") continue;
          if (
            !identifier.test(p) ||
            p.length > 128 ||
            reserved.has(p) ||
            (params.has(p) && !params.get(p))
          )
            throw Error();
          paramTypes[p] =
            d.cellValue && p === "cell__value"
              ? cellTypes.get(d.name)
              : rowKeys.has(p)
                ? null
                : (params.get(p) ?? null);
        }
        result.mutations.push({
          name: d.name,
          bindingName: catalog.name,
          datasetLegacyId: catalog.datasetLegacyId,
          target: { schema: table.schema, table: table.name },
          sqlSchema: catalog.name,
          sql: d.sql,
          paramTypes,
          ...(a.reads.some((r) => r.schema === "main" && r.table === "_members")
            ? { readsMembers: true as const }
            : {}),
          ...(Object.keys(rowParams).length ? { rowParams } : {}),
          ...(d.cellValue
            ? {
                valueParam: {
                  param: "cell__value",
                  type: cellTypes.get(d.name)!,
                },
              }
            : {}),
          ...(d.reset.length ? { reset: d.reset } : {}),
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
