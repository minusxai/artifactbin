import { FieldNotExecuted } from "../graphql/af-namespace-contracts.ts";
import type { SqlDatabase } from "../persistence/sql.ts";
import { DEFAULT_SQL_POOL_CAPACITY } from "../persistence/sql-contracts.ts";
import {
  NATIVE_PROGRAM_SQL_RESERVED_CONNECTIONS,
  type NativeProgramCapacityFailure,
  type NativeProgramSqlBudget,
} from "./native-program-lock-contracts.ts";

interface Admission extends NativeProgramSqlBudget { active: number }
/** Shared by every host using this application database, never a per-host quota. */
const admissions = new WeakMap<SqlDatabase, Admission>();
function admission(database: SqlDatabase): Admission {
  const poolCapacity = database.poolCapacity ?? DEFAULT_SQL_POOL_CAPACITY;
  const reservedConnections = NATIVE_PROGRAM_SQL_RESERVED_CONNECTIONS;
  if (!Number.isSafeInteger(poolCapacity) || poolCapacity <= reservedConnections)
    throw new RangeError("Native program SQL pool capacity must exceed reserved connection headroom");
  const existing = admissions.get(database);
  if (existing) {
    if (existing.poolCapacity !== poolCapacity)
      throw new RangeError("Native program SQL pool capacity changed during service lifetime");
    return existing;
  }
  const value = { poolCapacity, reservedConnections, lockHolders: poolCapacity - reservedConnections, active: 0 };
  admissions.set(database, value);
  return value;
}
function busy(): NativeProgramCapacityFailure {
  return Object.assign(new FieldNotExecuted("Native program execution is busy; retry after an active invocation finishes", "native_program_capacity"), {
    code: "native_program_capacity" as const,
    retryable: true as const,
  });
}
/** Cross-process no-overlap, with SQL headroom for fresh authority checks.
 * Admission never queues. The permit and lock stay held through invocation cleanup,
 * including cancellation; releasing early would permit overlapping native execution.
 */
export async function withNativeProgramLock<T>(
  database: SqlDatabase,
  pageId: string,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const budget = admission(database);
  if (budget.active >= budget.lockHolders) throw busy();
  budget.active++;
  try {
    return await database.transaction(async (client) => {
      signal?.throwIfAborted();
      const result = await client.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",
        ["native-program:" + pageId],
      );
      signal?.throwIfAborted();
      if (result.rows[0]?.acquired !== true)
        throw Error("Native program already running");
      return run();
    });
  } finally {
    budget.active--;
  }
}
