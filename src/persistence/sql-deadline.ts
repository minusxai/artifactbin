import type {
  SqlClient,
  SqlDatabaseOptions,
  SqlTransactionOptions,
} from "./sql-contracts.ts";
/** Opt-in bounded transaction. Socket disposal interrupts the driver; PostgreSQL's remaining-budget statement_timeout bounds server work independently. */
export async function deadlineSqlTransaction<T>(
  options: SqlDatabaseOptions,
  work: (client: SqlClient) => Promise<T>,
  budget: SqlTransactionOptions,
): Promise<T> {
  if (
    !Number.isSafeInteger(budget.timeoutMs) ||
    budget.timeoutMs < 1 ||
    budget.timeoutMs > 2147483647
  )
    throw new RangeError("Invalid SQL deadline");
  const controller = new AbortController();
  const deadline = Date.now() + budget.timeoutMs;
  let client: SqlClient | undefined,
    released = false;
  const release = (discard?: boolean) => {
    if (client && !released) {
      released = true;
      client.release(discard);
    }
  };
  const forward = () => controller.abort(budget.signal?.reason);
  const stop = () => {
    release(true);
  };
  budget.signal?.addEventListener("abort", forward, { once: true });
  if (budget.signal?.aborted) forward();
  const timer = setTimeout(
    () => controller.abort(Error("SQL deadline exceeded")),
    budget.timeoutMs,
  );
  let rejectStop!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectStop = reject;
  });
  void cancelled.catch(() => {});
  const onAbort = () => {
    stop();
    rejectStop(controller.signal.reason ?? Error("SQL cancelled"));
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const check = () => {
    controller.signal.throwIfAborted();
    if (Date.now() >= deadline) {
      controller.abort(Error("SQL deadline exceeded"));
      controller.signal.throwIfAborted();
    }
  };
  const wait = async <V>(promise: Promise<V>): Promise<V> => {
    try {
      check();
    } catch (error) {
      void promise.catch(() => {});
      throw error;
    }
    return Promise.race([promise, cancelled]);
  };
  try {
    check();
    await wait(options.initialize());
    check();
    const acquisition = options.pool.connect().then((acquired) => {
      client = acquired;
      if (controller.signal.aborted) release(true);
      return acquired;
    });
    await wait(acquisition);
    check();
    await wait(client!.query("BEGIN"));
    if (options.lockTimeoutMs !== undefined)
      await wait(
        client!.query(`SET LOCAL lock_timeout='${options.lockTimeoutMs}ms'`),
      );
    const query: SqlClient["query"] = async (text, values) => {
      check();
      const remaining = Math.max(1, deadline - Date.now());
      const timeout =
        options.statementTimeoutMs === 0
          ? remaining
          : Math.min(remaining, options.statementTimeoutMs);
      await wait(client!.query(`SET LOCAL statement_timeout='${timeout}ms'`));
      check();
      return wait(client!.query(text, values));
    };
    const guarded: SqlClient = {
      query,
      release: () => {
        throw Error("Transaction owns SQL connection");
      },
    };
    const value = await wait(work(guarded));
    await query("COMMIT");
    return value;
  } catch (error) {
    if (client && !released) {
      try {
        await wait(client.query("ROLLBACK"));
      } catch {
        release(true);
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
    budget.signal?.removeEventListener("abort", forward);
    controller.signal.removeEventListener("abort", onAbort);
    release();
  }
}
