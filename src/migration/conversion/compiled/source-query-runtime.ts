import { normalizeLocalTimestamp } from "./local-state.ts";
import type {
  CompiledSourceQueryBinding,
  CompiledSourceQueryEngine,
  CompiledSourceQueryPorts,
} from "./source-query-contracts.ts";
import type { CompiledQueryEvaluation } from "./query-evaluation-contracts.ts";
import type { CompiledQueryPage } from "./query-controller-contracts.ts";
import type { CompiledDisplayTable } from "./data-control-contracts.ts";
import { validCompiledSourceQueries } from "./source-query-admission.ts";
const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const scalar = (v: unknown, type: string) =>
  v === null ||
  (type === "number"
    ? typeof v === "number" && Number.isFinite(v)
    : type === "boolean"
      ? typeof v === "boolean"
      : typeof v === "string");
/** The controller owns cancellation/late publication. This port never supplies platform inputs or SQL. */
export function createCompiledSourceQueryEngine(
  bindings: readonly CompiledSourceQueryBinding[],
  ports: CompiledSourceQueryPorts,
): CompiledSourceQueryEngine {
  if (!validCompiledSourceQueries(bindings) || !bindings.length)
    throw Error("Invalid source query bindings");
  const page = async (
    _flow: unknown,
    name: string,
    request: CompiledQueryPage,
    evaluation: CompiledQueryEvaluation,
  ): Promise<CompiledDisplayTable> => {
    const b = bindings.find((b) => b.name === name);
    if (
      !b ||
      !Number.isSafeInteger(request.offset) ||
      request.offset < 0 ||
      !Number.isSafeInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 1000
    )
      throw Error("Invalid source query page");
    if (
      request.sort &&
      (!b.columns.some((c) => c.name === request.sort!.col) ||
        !["asc", "desc"].includes(request.sort.dir))
    )
      throw Error("Invalid source query sort");
    const values: Record<string, unknown> = {};
    for (const [name, type] of Object.entries(b.params)) {
      if (["_me__id", "_now", "_tz"].includes(name)) continue;
      const value =
        type === "timestamp" && evaluation.values[name] !== null
          ? normalizeLocalTimestamp(evaluation.values[name])
          : evaluation.values[name];
      if (!Object.hasOwn(evaluation.values, name) || !scalar(value, type))
        throw Error("Invalid source query value");
      Object.defineProperty(values, name, {
        value,
        enumerable: true,
      });
    }
    const raw = await ports.read(b, {
      name,
      valuesJson: JSON.stringify(values),
      offset: request.offset,
      limit: request.limit,
      sortJson: request.sort ? JSON.stringify(request.sort) : null,
    });
    if (
      typeof raw !== "string" ||
      new TextEncoder().encode(raw).length > 1024 * 1024
    )
      throw Error("Invalid source query response");
    const t: unknown = JSON.parse(raw);
    if (
      !record(t) ||
      Object.keys(t).some(
        (k) => !["columns", "rows", "truncated", "totalRows"].includes(k),
      ) ||
      JSON.stringify(t.columns) !== JSON.stringify(b.columns) ||
      !Array.isArray(t.rows) ||
      t.rows.length > request.limit ||
      t.rows.some(
        (r) =>
          !record(r) ||
          Object.keys(r).length !== b.columns.length ||
          b.columns.some(
            (c) => !Object.hasOwn(r, c.name) || !scalar(r[c.name], c.type),
          ),
      )
    )
      throw Error("Invalid source query rows");
    if (t.truncated !== undefined && typeof t.truncated !== "boolean")
      throw Error("Invalid source query window");
    if (
      t.totalRows !== undefined &&
      (!Number.isSafeInteger(t.totalRows) ||
        Number(t.totalRows) <
          (t.rows.length ? request.offset + t.rows.length : 0))
    )
      throw Error("Invalid source query count");
    if (t.truncated === true && t.rows.length !== request.limit)
      throw Error("Unbounded source query window");
    return t as unknown as CompiledDisplayTable;
  };
  return {
    prepare() {},
    ready: () => true,
    page,
    async run(flow, names, evaluation) {
      const tables: Record<string, CompiledDisplayTable> = {},
        errors: Record<string, string> = {};
      let cursor = 0;
      const worker = async () => {
        while (cursor < names.length) {
          const name = names[cursor++]!;
          try {
            tables[name] = await page(
              flow,
              name,
              { offset: 0, limit: 1000 },
              evaluation,
            );
          } catch {
            errors[name] = "Source query unavailable";
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(4, names.length) }, worker),
      );
      return { tables, errors };
    },
  };
}
