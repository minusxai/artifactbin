import type {
  ConnectorCaller,
  ConnectorOperation,
  Json,
  PgClient,
  SqlBinding,
} from "./contracts.ts";
import { ConnectorError, snapshot } from "./json.ts";
export interface AcquisitionBudget {
  pending: number;
  limit: number;
}
export async function invokePostgres(
  binding: SqlBinding,
  caller: ConnectorCaller,
  operations: readonly ConnectorOperation[],
  signal: AbortSignal,
  maxBytes: number,
  timeoutMs: number,
  budget: AcquisitionBudget,
  dispatch: () => void,
): Promise<Json[]> {
  // Parameter generation is trusted binding code, but its output must cross the JSON boundary before checkout.
  const prepared = operations.map((op) => {
    const definition = binding.operations[op.operation]!;
    return {
      text: definition.text,
      values: snapshot(definition.params(caller, op.input), maxBytes) as Json[],
    };
  });
  if (budget.pending >= budget.limit) throw new ConnectorError("UNAVAILABLE");
  let client: PgClient | undefined,
    released = false;
  const release = (destroy: boolean) => {
    if (client && !released) {
      released = true;
      client.release(destroy);
    }
  };
  let rejectStop!: (reason: unknown) => void;
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const abort = () => {
    release(true);
    rejectStop(signal.reason);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    budget.pending++;
    const acquired = Promise.resolve()
      .then(() => binding.pool.connect())
      .then((c) => {
        client = c;
        if (signal.aborted) {
          release(true);
          throw signal.reason;
        }
        return c;
      })
      .finally(() => {
        budget.pending--;
      });
    await Promise.race([acquired, stopped]);
    const query = (text: string, values?: unknown[]) => {
      signal.throwIfAborted();
      return Promise.race([client!.query(text, values), stopped]);
    };
    await query("BEGIN");
    await query("SELECT set_config('statement_timeout',$1,true)", [
      String(timeoutMs),
    ]);
    const results: Json[] = [];
    for (const op of prepared) {
      dispatch();
      const result = await query(op.text, op.values);
      results.push(snapshot(result.rows, maxBytes));
    }
    await query("COMMIT");
    return snapshot(results, maxBytes) as Json[];
  } catch (e) {
    if (client && !released) {
      try {
        await Promise.race([client.query("ROLLBACK"), stopped]);
      } catch {
        release(true);
      }
    }
    if ((e as { code?: string }).code === "57014")
      throw new ConnectorError("TIMEOUT", "unknown");
    throw e;
  } finally {
    signal.removeEventListener("abort", abort);
    release(false);
  }
}
