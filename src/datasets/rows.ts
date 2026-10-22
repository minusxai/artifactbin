import { createHash } from "node:crypto";
import { normalizeTimestamp } from "./timestamp.ts";
import {
  DatasetReadError,
  DATASET_OBJECT_BYTES,
  type DatasetTable,
  type DatasetCell,
} from "./contracts.ts";
const invalid = (): never => {
  throw new DatasetReadError("invalid_dataset");
};
function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function cell(value: unknown, type: string): DatasetCell {
  if (value === undefined || value === null) return null;
  if (type === "number")
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : invalid();
  if (type === "boolean")
    return typeof value === "boolean"
      ? value
      : value === 0
        ? false
        : value === 1
          ? true
          : invalid();
  if (type === "date") {
    if (typeof value !== "string") return invalid();
    // Legacy engines read timestamps in old date columns as the calendar day they name.
    const day = /^\d{4}-\d{2}-\d{2}[T ]/.test(value)
      ? value.slice(0, 10)
      : value;
    return calendarDate(day) ? day : invalid();
  }
  if (type === "timestamp") return normalizeTimestamp(value);

  // user cells are stable stored identities, not handles; membership constraints apply to writes.
  return typeof value === "string" ? value : invalid();
}
export function validateTable(table: DatasetTable): void {
  if (
    !table ||
    typeof table.schema !== "string" ||
    !table.schema ||
    typeof table.name !== "string" ||
    !table.name ||
    !Array.isArray(table.columns) ||
    table.columns.length > 1024
  )
    invalid();
  const names = new Set<string>();
  for (const c of table.columns) {
    if (
      !c ||
      typeof c.name !== "string" ||
      !c.name ||
      c.name.includes("\0") ||
      names.has(c.name) ||
      !["string", "number", "boolean", "date", "timestamp", "user"].includes(
        c.type,
      )
    )
      invalid();
    names.add(c.name);
  }
  const o = table.object;
  if (
    !o ||
    !/^dataset\/[a-f0-9]{32}$/.test(o.key) ||
    !/^[a-f0-9]{64}$/.test(o.sha256) ||
    o.key.slice(8) !== o.sha256.slice(0, 32) ||
    !Number.isSafeInteger(o.bytes) ||
    o.bytes < 2 ||
    o.bytes > DATASET_OBJECT_BYTES
  )
    invalid();
}
export function projectRow(
  row: Record<string, unknown>,
  table: DatasetTable,
): Record<string, DatasetCell> {
  const entries: [string, DatasetCell][] = [];
  for (const c of table.columns)
    entries.push([
      c.name,
      cell(Object.hasOwn(row, c.name) ? row[c.name] : undefined, c.type),
    ]);
  return Object.fromEntries(entries);
}
function boundedRowCount(text: string): void {
  let depth = 0,
    quoted = false,
    escaped = false,
    count = 1;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") depth--;
    else if (char === "," && depth === 1 && ++count > 100000) invalid();
  }
}
export async function readRows(
  table: DatasetTable,
  source: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  validateTable(table);
  let size = 0;
  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  for await (const chunk of source) {
    signal?.throwIfAborted();
    if (!(chunk instanceof Uint8Array)) invalid();
    size += chunk.byteLength;
    if (size > table.object.bytes || size > DATASET_OBJECT_BYTES) invalid();
    const copy = Buffer.from(chunk);
    hash.update(copy);
    chunks.push(copy);
  }
  if (size !== table.object.bytes || hash.digest("hex") !== table.object.sha256)
    invalid();
  let data: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    boundedRowCount(text);
    data = JSON.parse(text);
  } catch {
    return invalid();
  }
  if (!Array.isArray(data)) return invalid();
  for (const row of data)
    if (!row || typeof row !== "object" || Array.isArray(row)) invalid();
  return data as Record<string, unknown>[];
}
