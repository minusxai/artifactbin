import type { SqlDatabase } from "../persistence/sql-contracts.ts";
import type { DatasetSqlExecutor } from "../backend/dataset-sql-contracts.ts";
import type { DatasetReadService } from "../datasets/contracts.ts";
import type { DatasetMutationService } from "../datasets/mutation/contracts.ts";
export interface DatasetRuntimeOptions {
  database: SqlDatabase;
  sourceDirectory?: string;
  mutationDirectory?: string;
  executor?: DatasetSqlExecutor;
  attachmentDirectory?: string;
  imageProcessor?: import("../datasets/attachments/image-processor-contracts.ts").ImageProcessor;
  sourceQueryResources?: {pool(resource:string):import("../connectors/contracts.ts").PgPool|undefined;close():Promise<void>};
  now?: () => number;
}
export interface DatasetRuntime {
  historicalReplay?: import("../datasets/history-contracts.ts").HistoricalDatasetReplay;
  userChoices?: import("../datasets/user-choices/contracts.ts").DatasetUserChoiceService;
  sourceQueries?: import("../datasets/source-query/contracts.ts").SourceQueryService;
  reads: DatasetReadService;
  attachments?: import("./dataset-attachment-http-contracts.ts").DatasetAttachmentHttpPorts;
  availability: import("../datasets/mutation/availability-contracts.ts").DatasetMutationAvailabilityService;
  person: import("../datasets/person-contracts.ts").DatasetPersonService;
  legacyViewer: import("../backend/legacy-viewer-contracts.ts").LegacyViewerCompatibility;
  viewer: import("../datasets/viewer-contracts.ts").DatasetViewerService;
  members: import("../datasets/members-contracts.ts").DatasetMembersService;
  mutations?: DatasetMutationService;
  /** One shared completion promise; attempt every owned close and wait for all to settle before rejecting. */
  close(): Promise<void>;
}
