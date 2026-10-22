import type { SqlDatabase } from "../persistence/sql-contracts.ts";
import type { DatasetSqlExecutor } from "../backend/dataset-sql-contracts.ts";
import type { DatasetReadService } from "../datasets/contracts.ts";
import type { DatasetMutationService } from "../datasets/mutation/contracts.ts";
export interface DatasetRuntimeOptions {
  database: SqlDatabase;
  sourceDirectory?: string;
  mutationDirectory?: string;
  executor?: DatasetSqlExecutor;
  now?: () => number;
}
export interface DatasetRuntime {
  reads: DatasetReadService;
  members: import("../datasets/members-contracts.ts").DatasetMembersService;
  mutations?: DatasetMutationService;
  close(): Promise<void>;
}
