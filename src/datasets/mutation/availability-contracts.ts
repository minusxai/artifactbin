import type { DatasetCallContext } from "../contracts.ts";
import type {
  DatasetMutationOperation,
  DatasetMutationHead,
} from "./contracts.ts";
/** Advisory only: no row/value constraint success is promised. */
export interface DatasetMutationAvailability {
  canAttempt: boolean;
}
export interface DatasetMutationAvailabilityPorts {
  snapshot(
    context: DatasetCallContext,
    name: string,
    signal?: AbortSignal,
  ): Promise<{
    operation: DatasetMutationOperation;
    head: DatasetMutationHead;
  } | null>;
}
export interface DatasetMutationAvailabilityService {
  mutationAvailability(
    context: DatasetCallContext,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<DatasetMutationAvailability>;
}
