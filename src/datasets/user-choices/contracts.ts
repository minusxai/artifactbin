import type { DatasetCallContext } from "../contracts.ts";
import type {
  UserConstraints,
  UserOption,
} from "../sql/engine/sql-contracts.ts";
/** Trusted publication proof. Never accepted from a page or sandbox. */
export interface DatasetUserChoiceBinding {
  name: string;
  column: string;
  bindingName: string;
  schema: string;
  table: string;
  sourceColumn: string;
}
export interface RegisteredDatasetUserChoiceBinding
  extends DatasetUserChoiceBinding {
  backendId: string;
  backendVersion: string;
  pageId: string;
  pageVersion: number;
  sourceNamespace: string;
}
export interface DatasetUserChoiceRequest {
  name: string;
  column: string;
}
export interface DatasetUserChoiceSnapshot {
  /** Covers exact registration, current page/source authority, permitted scopes and profiles. */
  generation: string;
  constraints: UserConstraints;
  callerUserId: string | null;
  /** Only members of currently readable constrained documents, never directory entries. */
  members: readonly UserOption[];
  self: UserOption | null;
}
export interface DatasetUserChoicePorts {
  snapshot(
    context: DatasetCallContext,
    request: DatasetUserChoiceRequest,
    signal?: AbortSignal,
  ): Promise<DatasetUserChoiceSnapshot | null>;
}
export interface DatasetUserChoiceService {
  userChoices(
    context: DatasetCallContext,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<UserOption[]>;
}
