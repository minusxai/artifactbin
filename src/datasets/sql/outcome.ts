import type { DatasetSqlJob } from "../mutation/contracts.ts";
import { DATASET_SQL_LIMITS as limits } from "../mutation/contracts.ts";
import type { DatasetColumn, MutationOutcome } from "./engine/sql-contracts.ts";
import { normalizeTimestamp } from "./engine/timestamp.ts";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).every((k) => keys.includes(k));
const count = (v: unknown, max: number) =>
  Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
function cell(v: unknown, c: DatasetColumn): boolean {
  if (v === null) return true;
  if (c.type === "number") return typeof v === "number" && Number.isFinite(v);
  if (c.type === "boolean") return typeof v === "boolean";
  if (typeof v !== "string") return false;
  if (c.type === "date")
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v
    );
  if (c.type === "timestamp") {
    try {
      return normalizeTimestamp(v) === v;
    } catch {
      return false;
    }
  }
  return true;
}
/** Shared controller and app-side result decoder. It validates shape/effect metadata, never grants authority. */
export function decodeDatasetSqlOutcome(
  job: DatasetSqlJob,
  value: unknown,
): MutationOutcome {
  const deny = (): never => {
    throw Error("sql_invalid_result");
  };
  if (!record(value)) return deny();
  if (Object.hasOwn(value, "error")) {
    if (
      !only(value, ["error", "code", "timedOut", "full"]) ||
      typeof value.error !== "string" ||
      value.error.length > 2048 ||
      (value.code !== undefined &&
        !["row_changed", "row_not_unique", "policy_denied"].includes(
          String(value.code),
        )) ||
      (value.timedOut !== undefined && typeof value.timedOut !== "boolean") ||
      (value.full !== undefined && typeof value.full !== "boolean")
    )
      return deny();
    return value as unknown as MutationOutcome;
  }
  const columns = job.input.table.columns;
  if (
    !only(value, ["rows", "columns", "affected", "analysis", "userWrites"]) ||
    JSON.stringify(value.columns) !== JSON.stringify(columns) ||
    !count(value.affected, limits.maxRows) ||
    !Array.isArray(value.rows) ||
    value.rows.length > limits.maxRows ||
    value.rows.length * columns.length > limits.maxCells ||
    !record(value.analysis)
  )
    return deny();
  for (const row of value.rows) {
    if (
      !record(row) ||
      Object.keys(row).length !== columns.length ||
      columns.some((c) => !Object.hasOwn(row, c.name) || !cell(row[c.name], c))
    )
      return deny();
  }
  const a = value.analysis;
  if (
    !only(a, ["operation", "columns", "functions"]) ||
    !["insert", "update", "delete"].includes(String(a.operation)) ||
    !Array.isArray(a.columns) ||
    a.columns.length > columns.length ||
    a.columns.some(
      (k) => typeof k !== "string" || !columns.some((c) => c.name === k),
    ) ||
    !Array.isArray(a.functions) ||
    a.functions.length > 1024 ||
    a.functions.some((f) => typeof f !== "string" || f.length > 128)
  )
    return deny();
  if (
    job.input.policy &&
    !job.input.policy.operations.includes(
      a.operation as "insert" | "update" | "delete",
    )
  )
    return deny();
  if (
    job.input.expectedAffected !== undefined &&
    value.affected !== job.input.expectedAffected
  )
    return deny();
  if (value.userWrites !== undefined) {
    if (
      !Array.isArray(value.userWrites) ||
      value.userWrites.length > limits.maxRows
    )
      return deny();
    const users = columns.filter((c) => c.type === "user");
    for (const row of value.userWrites)
      if (
        !record(row) ||
        Object.entries(row).some(
          ([k, v]) =>
            !users.some((c) => c.name === k) ||
            !(v === null || typeof v === "string"),
        )
      )
        return deny();
  }
  if (
    columns.some((c) => c.type === "user") &&
    !Array.isArray(value.userWrites)
  )
    return deny();
  return value as unknown as MutationOutcome;
}
