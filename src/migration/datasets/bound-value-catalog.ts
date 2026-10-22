import type { LegacyRow } from "../contracts.ts";
import type { DatasetTable } from "../../datasets/contracts.ts";
import type {
  BoundValueCatalog,
  BoundValueColumnProof,
} from "../conversion/compiled/bound-value-contracts.ts";
import { validBoundValueProof } from "../conversion/compiled/bound-value-proof.ts";
import { record } from "./catalog.ts";
/** Pair already verified table schemas with the immutable original user constraints.
 * This offline metadata is never a read grant and must never enter a page bundle. */
export function boundValueCatalog(
  bindingName: string,
  row: LegacyRow,
  verifiedTables: readonly DatasetTable[],
): BoundValueCatalog {
  const fail = (): never => {
    throw Error("Invalid bound Value source catalog");
  };
  if (
    row.format !== "dataset" ||
    typeof row.id !== "string" ||
    !Number.isSafeInteger(row.version) ||
    Number(row.version) < 1 ||
    !record(row.meta)
  )
    return fail();
  const original = row.meta.catalog;
  if (
    original !== undefined &&
    (!record(original) ||
      original.kind !== "stored" ||
      !Array.isArray(original.tables))
  )
    return fail();
  const rawTables = record(original)
    ? (original.tables as unknown[])
    : [{ schema: "public", name: "rows", columns: row.meta.columns }];
  const tables = verifiedTables.map((table) => {
    const matches = rawTables.filter(
      (t) => record(t) && t.schema === table.schema && t.name === table.name,
    );
    if (matches.length !== 1) return fail();
    const raw = matches[0];
    if (!record(raw) || !Array.isArray(raw.columns)) return fail();
    const rawColumns = raw.columns;
    return {
      schema: table.schema,
      name: table.name,
      columns: table.columns.map((column) => {
        if (column.type !== "user") return { ...column };
        const matches = rawColumns.filter(
          (c) => record(c) && c.name === column.name,
        );
        if (matches.length !== 1) return fail();
        const source = matches[0];
        if (!record(source) || source.type !== "user") return fail();
        const proof = {
          valueName: "value",
          sourceRef: `ref:${row.id}`,
          version: Number(row.version),
          bindingName,
          schema: table.schema,
          table: "rows",
          column: column.name,
          type: "user",
          ...(source.constraints === undefined
            ? {}
            : { constraints: source.constraints }),
        };
        if (!validBoundValueProof(proof)) return fail();
        return {
          name: column.name,
          type: "user",
          ...(proof.constraints === undefined
            ? {}
            : {
                constraints: structuredClone(
                  (proof as BoundValueColumnProof).constraints,
                ),
              }),
        };
      }),
    };
  });
  return {
    bindingName,
    sourceRef: `ref:${row.id}`,
    version: Number(row.version),
    tables,
  };
}
