import type { SqlDatabase } from "../persistence/sql.ts";
import type { DatasetSqlExecutor } from "../backend/dataset-sql-contracts.ts";
import type { DatasetReadService } from "./contracts.ts";
import type { DatasetMutationService } from "./mutation/contracts.ts";
export interface DatasetRuntimeOptions {
  database: SqlDatabase;
  sourceDirectory?: string;
  mutationDirectory?: string;
  executor?: DatasetSqlExecutor;
  now?: () => number;
}
export interface DatasetRuntime {
  reads: DatasetReadService;
  mutations?: DatasetMutationService;
  close(): Promise<void>;
}
