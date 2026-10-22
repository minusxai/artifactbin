import type { LegacyRow } from "../contracts.ts";
import type { DatasetTable } from "../../datasets/contracts.ts";
import { validateTable } from "../../datasets/rows.ts";
import type { DatasetImportMetadata } from "../../datasets/import-contracts.ts";
import type { DatasetObjectReceipt } from "./planner-contracts.ts";
import { createHash } from "node:crypto";
export const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (record(v))
    return (
      "{" +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
        .join(",") +
      "}"
    );
  return JSON.stringify(v) ?? "null";
}
export function receiptMap(
  receipts: readonly DatasetObjectReceipt[],
): Map<string, DatasetObjectReceipt> {
  const map = new Map<string, DatasetObjectReceipt>();
  for (const r of receipts) {
    if (
      !/^dataset\/[a-f0-9]{32}$/.test(r.objectKey) ||
      !/^[a-f0-9]{64}$/.test(r.sha256) ||
      !r.sha256.startsWith(r.objectKey.slice(8)) ||
      r.status !== "copied" ||
      !Number.isSafeInteger(r.bytes) ||
      r.bytes < 2 ||
      map.has(r.objectKey)
    )
      throw Error("Invalid or ambiguous dataset object receipt");
    map.set(r.objectKey, r);
  }
  return map;
}
export function catalogVersion(
  row: LegacyRow,
  legacyId: string,
  receipts: Map<string, DatasetObjectReceipt>,
): DatasetImportMetadata["versions"][number] {
  if (
    !Number.isSafeInteger(row.version) ||
    Number(row.version) < 1 ||
    row.format !== "dataset" ||
    !record(row.meta)
  )
    throw Error("Invalid dataset version");
  const meta = row.meta;
  const original = meta.catalog;
  if (Object.hasOwn(meta, "catalog") && !record(original))
    throw Error("Invalid stored source catalog");
  const catalog = record(original)
    ? original
    : {
        kind: "stored",
        defaultSchema: "public",
        tables: [
          {
            schema: "public",
            name: "rows",
            columns: meta.columns ?? [],
            ...(meta.objectKey ? { objectKey: meta.objectKey } : {}),
          },
        ],
      };
  if (
    !["stored", "postgres"].includes(String(catalog.kind)) ||
    !Array.isArray(catalog.tables)
  )
    throw Error("Unsupported dataset catalog");
  if (meta.objectKey !== undefined && record(original)) {
    const alias = catalog.tables.find(
      (t) => record(t) && t.schema === "public" && t.name === "rows",
    );
    if (!record(alias) || alias.objectKey !== meta.objectKey)
      throw Error("Conflicting legacy row alias");
  }
  const tables: DatasetTable[] = [];
  const unavailableTables: DatasetImportMetadata["versions"][number]["unavailableTables"][number][] =
    [];
  const seen = new Set<string>();
  for (const t of catalog.tables) {
    if (
      !record(t) ||
      typeof t.schema !== "string" ||
      !t.schema ||
      typeof t.name !== "string" ||
      !t.name ||
      !Array.isArray(t.columns)
    )
      throw Error("Invalid dataset table");
    const identity = JSON.stringify([t.schema, t.name]);
    if (seen.has(identity)) throw Error("Ambiguous dataset table");
    seen.add(identity);
    if (
      catalog.kind === "postgres" ||
      t.sql !== undefined ||
      t.modelCellId !== undefined
    ) {
      unavailableTables.push({
        schema: t.schema,
        name: t.name,
        reason: catalog.kind === "postgres" ? "external" : "model",
      });
      continue;
    }
    if (t.source !== undefined)
      throw Error("Stored table has unsupported source");
    const empty = createHash("sha256").update("[]").digest("hex");
    const sourceKey = t.objectKey ?? "dataset/" + empty.slice(0, 32);
    if (typeof sourceKey !== "string") throw Error("Invalid row object key");
    const receipt = receipts.get(sourceKey);
    if (!receipt) throw Error("Dataset object has no verified receipt");
    const columns = t.columns.map((c) => {
      if (
        !record(c) ||
        typeof c.name !== "string" ||
        typeof c.type !== "string"
      )
        throw Error("Invalid dataset column");
      return {
        name: c.name,
        type: c.type as DatasetTable["columns"][number]["type"],
      };
    });
    const table: DatasetTable = {
      schema: t.schema,
      name: t.name,
      columns,
      object: {
        key: receipt.sha256,
        sha256: receipt.sha256,
        bytes: receipt.bytes,
      },
    };
    validateTable(table);
    tables.push(table);
  }
  return {
    legacyId,
    version: Number(row.version),
    tables,
    unavailableTables,
    catalog: structuredClone(original ?? catalog),
  };
}
