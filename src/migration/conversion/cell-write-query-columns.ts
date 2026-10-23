import type {LegacyCellWriteColumn} from "./compiled/cell-write-contracts.ts";
import type { DatasetColumn } from "../../datasets/contracts.ts";
import type { SqliteDatabase } from "../../datasets/sql/engine/database.ts";
import type { LegacyCellWriteQuery } from "./cell-write-query-contracts.ts";
/** Prepare only: declared column origins survive aliases/dependencies, expressions stay unknown.
 * Placeholder storage for unknown outputs is never exposed as an authoritative type. */
export function legacyCellWriteQueryColumns(
  db: SqliteDatabase,
  queries: readonly LegacyCellWriteQuery[],
  sourceAdmission: import("../conversion-strategy-contracts.ts").MigrationSourceAdmission="strict",
): Readonly<Record<string, readonly LegacyCellWriteColumn[]>> {
  if (queries.length > 256) throw Error("Cell query limit");
  const result: Record<string, LegacyCellWriteColumn[]> = Object.create(null);
  const unknown = new Set<string>(),
    names = new Set<string>();
  const key = (table: string, column: string) =>
    `${table.toLowerCase()}\0${column.toLowerCase()}`;
  for (const q of queries) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(q.name) ||
      names.has(q.name.toLowerCase()) ||
      ["constructor", "prototype"].includes(q.name) ||
      Buffer.byteLength(q.sql) > 64000
    )
      throw Error("Invalid cell query");
    names.add(q.name.toLowerCase());
  }
  const origins = new Map<string,{schema:string;table:string;column:string}>();
  let pending = [...queries];
  while (pending.length) {
    const next: LegacyCellWriteQuery[] = [];
    for (const q of pending) {
      let prepared;
      try {
        prepared = db.prepare(q.sql, "read");
      } catch {
        next.push(q);
        continue;
      }
      try {
        const seen = new Set<string>(),
          all: DatasetColumn[] = [],
          known: LegacyCellWriteColumn[] = [];
        for (const c of prepared.analysis.columns) {
          if (seen.has(c.name.toLowerCase()))
            throw Error("Ambiguous cell query column");
          seen.add(c.name.toLowerCase());
          const type =
            c.declaredType &&
            !(
              c.origin?.schema.toLowerCase() === "main" &&
              unknown.has(key(c.origin.table, c.origin.column))
            )
              ? c.declaredType
              : null;
          all.push({ name: c.name, type: type ?? "string" });
          const origin=c.origin?.schema.toLowerCase()==="main"
            ? origins.get(key(c.origin.table,c.origin.column)) : c.origin;
          if(origin)origins.set(key(q.name,c.name),origin);
          if (type || sourceAdmission==="offline-prototype") known.push({ name: c.name, type, ...(origin?{origin}: {}) });
          if (!type) unknown.add(key(q.name, c.name));
        }
        db.createTable({ schema: "main", table: q.name, columns: all });
        result[q.name] = known;
      } finally {
        prepared.finalize();
      }
    }
    if (next.length === pending.length)
      throw Error("Unresolved cell query dependency");
    pending = next;
  }
  return result;
}
