import type { DatasetSqlJob } from "../datasets/mutation/contracts.ts";
import type { MutationOutcome } from "../datasets/sql/engine/sql-contracts.ts";
export interface DatasetSqlExecutor {
  execute(job: DatasetSqlJob, signal?: AbortSignal): Promise<MutationOutcome>;
  query?(
    job: import("../datasets/query/contracts.ts").DatasetQueryJob,
    signal?: AbortSignal,
  ): Promise<import("../datasets/query/contracts.ts").ServerQueryAnswer>;
  close(): Promise<void>;
}
export interface DatasetSqlExecutorOptions {
  image?: string;
  deploymentNamespace?: string;
  maxConcurrent?: number;
}
export interface RemoteDatasetSqlOptions {
  endpoint?: string;
  socketPath?: string;
  secret: string;
}
