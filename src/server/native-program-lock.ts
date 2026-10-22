import type { SqlDatabase } from "../persistence/sql.ts";
/** Cross-process no-overlap admission, held until invocation and isolate cleanup finish. */
export function withNativeProgramLock<T>(
  database: SqlDatabase,
  pageId: string,
  run: () => Promise<T>,
): Promise<T> {
  return database.transaction(async (client) => {
    const result = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",
      ["native-program:" + pageId],
    );
    if (result.rows[0]?.acquired !== true)
      throw Error("Native program already running");
    return run();
  });
}
