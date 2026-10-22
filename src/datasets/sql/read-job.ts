import { normalizeTimestamp } from "./engine/timestamp.ts";
import {
  SERVER_QUERY_LIMITS as limits,
  type DatasetQueryJob,
  type ServerQueryAnswer,
} from "../query/contracts.ts";
export const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const scalar = (v: unknown) =>
  v === null ||
  typeof v === "string" ||
  typeof v === "boolean" ||
  (typeof v === "number" && Number.isFinite(v));
function cell(v: unknown, type: unknown): boolean {
  if (v === null) return true;
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  if (type === "boolean") return typeof v === "boolean";
  if (typeof v !== "string") return false;
  if (type === "date")
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v
    );
  if (type === "timestamp") {
    try {
      return normalizeTimestamp(v) === v;
    } catch {
      return false;
    }
  }
  return type === "string" || type === "user";
}
export const types = new Set([
  "string",
  "number",
  "boolean",
  "date",
  "timestamp",
  "user",
]);
export const name = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(v) &&
  !["constructor", "prototype", "__proto__"].includes(v);
const only = (v: Record<string, unknown>, fields: string[]) =>
  Object.keys(v).every((k) => fields.includes(k));
export function validateDatasetQueryJob(
  v: unknown,
): asserts v is DatasetQueryJob {
  const fail = (): never => {
    throw Error("invalid_query_job");
  };
  if (
    !record(v) ||
    !only(v, ["kind", "engineVersion", "input"]) ||
    v.kind !== "dataset-query" ||
    v.engineVersion !== "sqlite-3.53.4-read-v1" ||
    !record(v.input)
  )
    return fail();
  const i = v.input;
  if (
    !only(i, ["tables", "queries", "params", "paramTypes"]) ||
    !Array.isArray(i.tables) ||
    i.tables.length > limits.maxTables ||
    !Array.isArray(i.queries) ||
    i.queries.length > limits.maxQueries ||
    !record(i.params) ||
    !record(i.paramTypes) ||
    Object.keys(i.params).length > limits.maxParams + 3 ||
    Object.keys(i.params).some(
      (k) => !name(k) || !scalar((i.params as Record<string, unknown>)[k]),
    ) ||
    Object.entries(i.paramTypes).some(
      ([k, t]) => !name(k) || !types.has(String(t)),
    )
  )
    return fail();
  const relations = new Set<string>();
  let rows = 0,
    cells = 0;
  for (const t of i.tables) {
    if (
      !record(t) ||
      !only(t, ["schema", "table", "columns", "rows"]) ||
      !name(t.schema) ||
      !name(t.table) ||
      !Array.isArray(t.columns) ||
      t.columns.length > 1024 ||
      !Array.isArray(t.rows)
    )
      return fail();
    const key = t.schema.toLowerCase() + "." + t.table.toLowerCase();
    if (relations.has(key)) return fail();
    relations.add(key);
    const columns = new Set<string>();
    for (const c of t.columns) {
      if (
        !record(c) ||
        !only(c, ["name", "type"]) ||
        typeof c.name !== "string" ||
        !c.name ||
        c.name.includes("\0") ||
        c.name.length > 128 ||
        columns.has(c.name.toLowerCase()) ||
        !types.has(String(c.type))
      )
        return fail();
      columns.add(c.name.toLowerCase());
    }
    for (const r of t.rows)
      if (
        !record(r) ||
        Object.keys(r).length !== columns.size ||
        Object.entries(r).some(
          ([k, v]) =>
            !(t.columns as { name: string }[]).some((c) => c.name === k) ||
            !scalar(v),
        )
      )
        return fail();
    rows += t.rows.length;
    cells += t.rows.length * t.columns.length;
  }
  if (rows > limits.maxRows || cells > limits.maxCells) return fail();
  const queries = new Set<string>();
  for (const q of i.queries) {
    if (
      !record(q) ||
      !only(q, ["name", "sql"]) ||
      !name(q.name) ||
      queries.has(q.name.toLowerCase()) ||
      relations.has("main." + q.name.toLowerCase()) ||
      typeof q.sql !== "string" ||
      !q.sql ||
      Buffer.byteLength(q.sql) > limits.maxSqlBytes
    )
      return fail();
    queries.add(q.name.toLowerCase());
  }
  if (Buffer.byteLength(JSON.stringify(v)) > limits.inputBytes) return fail();
}
/** Strict fixed-controller result boundary, independent of source/caller authorization. */
export function decodeDatasetQueryAnswer(
  job: DatasetQueryJob,
  v: unknown,
): ServerQueryAnswer {
  const fail = (): never => {
    throw Error("sql_invalid_result");
  };
  if (
    !record(v) ||
    !only(v, ["tables", "errors"]) ||
    !record(v.tables) ||
    !record(v.errors) ||
    Buffer.byteLength(JSON.stringify(v)) > limits.outputBytes
  )
    return fail();
  const names = new Set(job.input.queries.map((q) => q.name));
  let rows = 0,
    cells = 0;
  for (const [key, t] of Object.entries(v.tables)) {
    if (
      !names.has(key) ||
      !record(t) ||
      !only(t, ["rows", "columns", "truncated", "totalRows"]) ||
      !Array.isArray(t.rows) ||
      !Array.isArray(t.columns) ||
      t.columns.length > 1024 ||
      (t.truncated !== undefined && t.truncated !== true) ||
      (t.totalRows !== undefined &&
        (!Number.isSafeInteger(t.totalRows) ||
          Number(t.totalRows) < t.rows.length))
    )
      return fail();
    const columns = new Set<string>();
    for (const c of t.columns) {
      if (
        !record(c) ||
        !only(c, ["name", "type"]) ||
        typeof c.name !== "string" ||
        !c.name ||
        columns.has(c.name) ||
        !types.has(String(c.type))
      )
        return fail();
      columns.add(c.name);
    }
    for (const r of t.rows)
      if (
        !record(r) ||
        Object.keys(r).length !== columns.size ||
        Object.entries(r).some(
          ([k, v]) =>
            !columns.has(k) ||
            !cell(
              v,
              (t.columns as { name: string; type: string }[]).find(
                (c) => c.name === k,
              )?.type,
            ),
        )
      )
        return fail();
    rows += t.rows.length;
    cells += t.rows.length * t.columns.length;
  }
  for (const [key, e] of Object.entries(v.errors))
    if (
      !names.has(key) ||
      Object.hasOwn(v.tables, key) ||
      typeof e !== "string" ||
      e.length > 2048
    )
      return fail();
  if (
    rows > limits.maxRows ||
    cells > limits.maxCells ||
    [...names].some(
      (n) =>
        !Object.hasOwn(v.tables as object, n) &&
        !Object.hasOwn(v.errors as object, n),
    )
  )
    return fail();
  return v as unknown as ServerQueryAnswer;
}
