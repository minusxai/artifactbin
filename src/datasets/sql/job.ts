import { parseDatasetPolicy } from "./engine/predicates.ts";
import {
  DATASET_SQL_LIMITS as limits,
  DatasetMutationError,
  type DatasetSqlJob,
} from "../mutation/contracts.ts";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const scalar = (v: unknown) =>
  v === null ||
  typeof v === "string" ||
  typeof v === "boolean" ||
  (typeof v === "number" && Number.isFinite(v));
/** Transport must cap the raw frame BEFORE JSON.parse; this is the independent fixed-engine admission gate. */
export function validateDatasetSqlJob(
  value: unknown,
): asserts value is DatasetSqlJob {
  const deny = () => {
    throw new DatasetMutationError("invalid_job");
  };
  if (
    !record(value) ||
    value.kind !== "dataset-sql" ||
    value.engineVersion !== "sqlite-3.53.4-effect-v1" ||
    Object.keys(value).some(
      (k) => !["kind", "engineVersion", "input"].includes(k),
    ) ||
    !record(value.input)
  )
    return deny();
  const input = value.input;
  if (
    Object.keys(input).some(
      (k) =>
        ![
          "table",
          "sql",
          "params",
          "paramTypes",
          "policy",
          "expectedAffected",
          "reads",
        ].includes(k),
    ) ||
    typeof input.sql !== "string" ||
    Buffer.byteLength(input.sql) > limits.maxSqlBytes ||
    !record(input.table) ||
    !record(input.params) ||
    Object.keys(input.params).length > limits.maxParams ||
    Object.values(input.params).some((v) => !scalar(v))
  )
    return deny();
  if (input.reads !== undefined) {
    if (!Array.isArray(input.reads) || input.reads.length !== 1) return deny();
    const relation = input.reads[0];
    if (
      !record(relation) ||
      Object.keys(relation).sort().join() !== "columns,rows,schema,table" ||
      relation.schema !== "main" ||
      relation.table !== "_members" ||
      JSON.stringify(relation.columns) !==
        JSON.stringify([
          { name: "user_id", type: "user" },
          { name: "joined_at", type: "timestamp" },
        ]) ||
      !Array.isArray(relation.rows) ||
      relation.rows.length > limits.maxRows
    )
      return deny();
    for (const row of relation.rows)
      if (
        !record(row) ||
        Object.keys(row).sort().join() !== "joined_at,user_id" ||
        typeof row.user_id !== "string" ||
        !row.user_id ||
        row.user_id.length > 16384 ||
        typeof row.joined_at !== "string" ||
        !Number.isFinite(Date.parse(row.joined_at))
      )
        return deny();
  }
  const table = input.table;
  if (
    typeof table.name !== "string" ||
    !table.name ||
    typeof table.schema !== "string" ||
    !table.schema ||
    !Array.isArray(table.columns) ||
    table.columns.length > 1024 ||
    !Array.isArray(table.rows) ||
    table.rows.length > limits.maxRows ||
    table.rows.length * table.columns.length > limits.maxCells
  )
    return deny();
  const names = new Set<string>();
  for (const c of table.columns) {
    if (
      !record(c) ||
      typeof c.name !== "string" ||
      !c.name ||
      c.name.includes("\0") ||
      names.has(c.name) ||
      !["string", "number", "boolean", "date", "timestamp", "user"].includes(
        String(c.type),
      )
    )
      return deny();
    names.add(c.name);
  }
  for (const row of table.rows)
    if (!record(row) || Object.values(row).some((v) => !scalar(v)))
      return deny();
  if (
    input.expectedAffected !== undefined &&
    (!Number.isSafeInteger(input.expectedAffected) ||
      Number(input.expectedAffected) < 0)
  )
    return deny();
  if (
    input.paramTypes !== undefined &&
    (!record(input.paramTypes) ||
      Object.values(input.paramTypes).some(
        (v) =>
          ![
            "string",
            "number",
            "boolean",
            "date",
            "timestamp",
            "user",
          ].includes(String(v)),
      ))
  )
    return deny();
  if (input.policy !== undefined) {
    const p = input.policy;
    if (
      !record(p) ||
      Object.keys(p).some(
        (k) =>
          !["table", "role", "session", "operations", "execution"].includes(k),
      ) ||
      p.role !== "viewer" ||
      !record(p.session) ||
      Object.values(p.session).some((v) => !scalar(v)) ||
      !Array.isArray(p.operations) ||
      !p.operations.length ||
      p.operations.some((v) => !["insert", "update", "delete"].includes(v))
    )
      return deny();
    try {
      const parsed = parseDatasetPolicy({
        version: 1,
        enforcement: "enabled",
        tables: [p.table],
        ...(p.execution === undefined ? {} : { execution: p.execution }),
      });
      if (
        parsed.execution?.extensions &&
        Object.keys(parsed.execution.extensions).length
      )
        return deny();
    } catch {
      return deny();
    }
  }
  try {
    if (Buffer.byteLength(JSON.stringify(value)) > limits.inputBytes)
      return deny();
  } catch {
    return deny();
  }
}
