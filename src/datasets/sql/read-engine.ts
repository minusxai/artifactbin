import { loadSqliteModule } from "./engine/wasm.ts";
import { SqliteDatabase } from "./engine/database.ts";
import {
  validateDatasetQueryJob,
  decodeDatasetQueryAnswer,
} from "./read-job.ts";
import {
  SERVER_QUERY_LIMITS as limits,
  type DatasetQueryJob,
  type ServerQueryAnswer,
} from "../query/contracts.ts";
class UnregisteredQueryParameter extends Error {}
/** Controller-only fixed read engine. Every relation arrives by authorized value; no filesystem catalog. */
export async function createDatasetQueryEngine() {
  const sqlite = await loadSqliteModule();
  return {
    query(job: DatasetQueryJob): ServerQueryAnswer {
      validateDatasetQueryJob(job);
      const db = new SqliteDatabase(sqlite),
        tables: ServerQueryAnswer["tables"] = Object.create(null),
        errors: ServerQueryAnswer["errors"] = Object.create(null);
      const deadline = performance.now() + limits.timeoutMs;
      let totalRows = 0,
        totalCells = 0;
      try {
        for (const table of job.input.tables) {
          db.attach(table.schema);
          db.load(table);
        }
        for (const q of job.input.queries) {
          try {
            const left = deadline - performance.now();
            if (left <= 0) throw Error("query_deadline");
            const stmt = db.prepare(q.sql, "read");
            let result;
            try {
              for (let index = 1; index <= stmt.stmt.parameterCount; index++) {
                const bound = sqlite.capi.sqlite3_bind_parameter_name(
                  stmt.stmt.pointer!,
                  index,
                );
                if (!bound || !Object.hasOwn(job.input.params, bound.slice(1)))
                  throw new UnregisteredQueryParameter();
              }
              result = stmt
                .bind(job.input.params, job.input.paramTypes)
                .rows(limits.maxRows - totalRows, left);
            } finally {
              stmt.finalize();
            }
            // Never expose a truncated dependency as though it were a complete relation.
            if (result.more) throw Error("query_row_limit");
            totalRows += result.rows.length;
            totalCells += result.rows.length * result.columns.length;
            if (totalCells > limits.maxCells) throw Error("query_cell_limit");
            tables[q.name] = { rows: result.rows, columns: result.columns };
            if (
              Buffer.byteLength(JSON.stringify({ tables, errors })) >
              limits.outputBytes
            ) {
              delete tables[q.name];
              throw Error("query_output_limit");
            }
            db.load({ schema: "main", table: q.name, ...tables[q.name]! });
          } catch (error) {
            // Engine diagnostics can embed input values; keep the RPC error bounded and generic.
            delete tables[q.name];
            errors[q.name] =
              error instanceof UnregisteredQueryParameter
                ? "unregistered_query_parameter"
                : "query_failed";
          }
        }
        return decodeDatasetQueryAnswer(job, { tables, errors });
      } finally {
        db.close();
      }
    },
  };
}
