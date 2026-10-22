import { validateDatasetSqlJob } from "./job.ts";
import { loadSqliteModule } from "./engine/wasm.ts";
import { runMutation } from "./engine/writes.ts";
import type { MutationInput, MutationOutcome } from "./engine/sql-contracts.ts";
import { DATASET_SQL_LIMITS } from "../mutation/contracts.ts";
/** Fixed engine entry. Synchronous work belongs ONLY in the execution-controller SQL isolate. */
export async function createDatasetMutationEngine(): Promise<{
  mutate(input: MutationInput): MutationOutcome;
}> {
  const sqlite = await loadSqliteModule();
  return {
    mutate(input) {
      validateDatasetSqlJob({
        kind: "dataset-sql",
        engineVersion: "sqlite-3.53.4-effect-v1",
        input,
      });
      return runMutation(sqlite, input, {
        limit: DATASET_SQL_LIMITS.maxRows,
        timeoutMs: DATASET_SQL_LIMITS.timeoutMs,
      });
    },
  };
}
