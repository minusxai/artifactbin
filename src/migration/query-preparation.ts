import { assertSavedProgramRegistration } from "./programs/registration.ts";
import { createHash } from "node:crypto";
import type {
  ColumnType,
  Scalar,
} from "../datasets/sql/engine/sql-contracts.ts";
import type {
  MigrationQueryCompiler,
  MigrationQueryCompilerInput,
  MigrationQueryReceipt,
} from "./query-preparation-contracts.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const name = (s: unknown): s is string =>
  typeof s === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,127}$/.test(s);
const types = new Set([
  "string",
  "number",
  "boolean",
  "date",
  "timestamp",
  "user",
]);
function scalar(type: string, value: unknown): value is Scalar {
  if (value === null) return true;
  if (type === "number")
    return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (typeof value !== "string") return false;
  if (type === "date")
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
    );
  if (type === "timestamp") return Number.isFinite(Date.parse(value));
  return type === "string" || type === "user";
}
/** Projection accepts only archived compiler facts; SQL dependencies are never inferred with text matching. */
export async function prepareMigrationQueryReceipt(
  input: MigrationQueryCompilerInput & {
    version: number;
    compilerIdentity: string;
  },
  compiler: MigrationQueryCompiler,
): Promise<MigrationQueryReceipt | null> {
  const result = await compiler(input);
  if (!result) return null;
  if (
    !Number.isSafeInteger(input.version) ||
    input.version < 1 ||
    !/^[a-f0-9]{64}$/.test(input.compilerIdentity) ||
    !/^[a-f0-9]{64}$/.test(result.module.sourceSha256)
  )
    throw Error("query_compiler_receipt_invalid");
  const flow = result.flow;
  if (
    flow.queries.length > 64 ||
    flow.imports.length > 64 ||
    flow.values.length > 240 ||
    flow.queries.some((q) => Buffer.byteLength(q.sql) > 64000)
  )
    throw Error("query_plan_limit");
  if (flow.mutations.some((m) => m.target.local))
    throw Error("query_mutable_local_default");
  const scalars: Record<string, { type: ColumnType; default: Scalar }> = {},
    tables: MigrationQueryReceipt["plan"]["tables"][number][] = [],
    seen = new Set<string>();
  for (const v of flow.values) {
    if (!name(v.name) || seen.has(v.name)) throw Error("query_value_invalid");
    seen.add(v.name);
    if (v.kind === "table") {
      if (
        !v.columns ||
        !v.rows ||
        v.columns.some((c) => !name(c.name) || !types.has(c.type)) ||
        new Set(v.columns.map((c) => c.name)).size !== v.columns.length
      )
        throw Error("query_table_invalid");
      for (const row of v.rows)
        if (
          Object.keys(row).some((k) => !v.columns!.some((c) => c.name === k)) ||
          v.columns.some((c) => !scalar(c.type, row[c.name]))
        )
          throw Error("query_table_row_invalid");
      tables.push({
        schema: "main",
        table: v.name,
        columns: v.columns.map((c) => ({
          name: c.name,
          type: c.type as ColumnType,
        })),
        rows: structuredClone([...v.rows]),
      });
    } else {
      if (!types.has(v.type) || !scalar(v.type, v.default))
        throw Error("query_scalar_invalid");
      scalars[v.name] = { type: v.type as ColumnType, default: v.default };
    }
  }
  const imports: MigrationQueryReceipt["plan"]["imports"][number][] = [];
  for (const i of flow.imports) {
    const selected = input.bindings.filter(
      (b) => b.name === i.name && b.legacyRef === `ref:${i.ref}`,
    );
    if (selected.length !== 1) throw Error("query_import_pin_mismatch");
    for (const table of i.tables) {
      const pinned = selected[0]!.tables.filter((t) => t.table === table.name);
      if (
        pinned.length !== 1 ||
        JSON.stringify(pinned[0]!.columns) !== JSON.stringify(table.columns)
      )
        throw Error("query_import_catalog_mismatch");
      imports.push({
        schema: i.name,
        table: table.name,
        read: { binding: i.name, schema: pinned[0]!.schema, table: table.name },
      });
    }
  }
  const ordered = new Set<string>(),
    queries: MigrationQueryReceipt["plan"]["queries"][number][] = [];
  for (const q of flow.queries) {
    if (
      !name(q.name) ||
      seen.has(q.name) ||
      ordered.has(q.name) ||
      q.engine !== "sqlite" ||
      q.source ||
      q.reads.queries.some((n) => !ordered.has(n)) ||
      q.reads.values.some((n) => !seen.has(n)) ||
      q.reads.imports.some((n) => !flow.imports.some((i) => i.name === n)) ||
      q.reads.builtins.some(
        (n) => !["_me", "_me.id", "_now", "_tz"].includes(n),
      )
    )
      throw Error("query_capability_unavailable");
    ordered.add(q.name);
    queries.push({
      name: q.name,
      sql: q.sql,
      dependencies: [...q.reads.queries],
    });
  }
  if (
    result.module.references.queries.some((n) => !ordered.has(n)) ||
    result.module.references.values.some((n) => !Object.hasOwn(scalars, n))
  )
    throw Error("query_module_reference_mismatch");
  const plan = { queries, scalars, tables, imports };
  if (Buffer.byteLength(JSON.stringify(plan)) > 8 * 1024 * 1024)
    throw Error("query_plan_limit");
  if (result.program)
    assertSavedProgramRegistration({
      sourceNamespace: "offline",
      moduleSourceSha256: result.module.sourceSha256,
      program: result.program,
      plan: {
        ...plan,
        registration: {
          backendId: "offline",
          backendVersion: "offline",
          pageId: "offline",
          pageVersion: input.version,
          sourceSha256: hash(input.source),
        },
      },
    });
  return {
    pageVersion: input.version,
    moduleSourceSha256: result.module.sourceSha256,
    flowSourceSha256: hash(input.source),
    compilerIdentity: input.compilerIdentity,
    plan,
    ...(result.program ? { program: result.program } : {}),
  };
}
