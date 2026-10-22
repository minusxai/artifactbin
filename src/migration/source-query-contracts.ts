import type { MigrationBackendReceipt } from "./backend-preparation-contracts.ts";
import type { MigrationSourceQueryRegistration } from "../datasets/source-query/contracts.ts";
export interface MigrationSourceQueryBatch {
  receipt: Pick<
    MigrationBackendReceipt,
    "pageLegacyId" | "pageId" | "pageVersion" | "backendId"
  > & { deployment: { version: string } };
  queries: readonly MigrationSourceQueryRegistration[];
}
