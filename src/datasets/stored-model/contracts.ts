import type {
  DatasetCallContext,
  DatasetResolvedBinding,
  DatasetTable,
} from "../contracts.ts";
import type { DatasetQueryJob, ServerQueryAnswer } from "../query/contracts.ts";
export interface StoredModelAttestation {
  schema: string;
  table: string;
  columns: DatasetTable["columns"];
  modelSqlSha256: string;
  sourceArtifactSha256: string;
  dependencyDescriptorSha256: string;
}
/** Server-attested original stored model. Never accepted from a runner or serialized into HTML.
 * The registry must bind the declaration to the exact saved backend/page and source hash. */
export interface RegisteredStoredModel {
  datasetVersion: number;
  sourceSha256: string;
  schema: string;
  table: string;
  columns: DatasetTable["columns"];
  sql: string;
  dependencies: readonly DatasetTable[];
}
export interface StoredModelPorts {
  resolve(
    context: DatasetCallContext,
    binding: DatasetResolvedBinding,
    table: { schema: string; table: string },
    signal?: AbortSignal,
  ): Promise<RegisteredStoredModel | null>;
  execute(
    job: DatasetQueryJob,
    signal?: AbortSignal,
  ): Promise<ServerQueryAnswer>;
}
