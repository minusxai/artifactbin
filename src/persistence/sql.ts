import { deadlineSqlTransaction } from "./sql-deadline.ts";
import type {
  SqlClient,
  SqlDatabase,
  SqlDatabaseOptions,
  SqlTransactionOptions,
} from "./sql-contracts.ts";
export type * from "./sql-contracts.ts";
export function createSqlDatabase({
  pool,
  initialize,
  statementTimeoutMs,
  lockTimeoutMs,
}: SqlDatabaseOptions): SqlDatabase {
  for (const timeout of [statementTimeoutMs, lockTimeoutMs]) {
    if (
      timeout !== undefined &&
      (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 2147483647)
    )
      throw new RangeError("Invalid SQL timeout");
  }
  return {
    async transaction<T>(
      work: (client: SqlClient) => Promise<T>,
      options?: SqlTransactionOptions,
    ): Promise<T> {
      if (options)
        return deadlineSqlTransaction(
          { pool, initialize, statementTimeoutMs, lockTimeoutMs },
          work,
          options,
        );
      await initialize();
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query("BEGIN");
        await client.query(
          `SET LOCAL statement_timeout='${statementTimeoutMs}ms'`,
        );
        if (lockTimeoutMs !== undefined)
          await client.query(`SET LOCAL lock_timeout='${lockTimeoutMs}ms'`);
        const value = await work(client);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
        throw error;
      } finally {
        client.release(discard || undefined);
      }
    },
  };
}
