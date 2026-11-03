/** Shared contracts for a document's saved, replayable mutation operations. */
import type { Scalar } from './sql';

/** Canonical explicit request inputs for persistent document-action replay. */
export interface MutationOperationRequest {
  documentId: string;
  mutation: string;
  args: Record<string, Scalar>;
  row?: Record<string, Scalar>;
  value?: Scalar;
  tz?: string;
  expectedState?: string;
}

/**
 * Persist this successful domain outcome once; route adapters render it to their
 * existing API/browser shapes on BOTH first response and replay. No effect images.
 */
export interface MutationOperationSuccess {
  datasetId: string;
  datasetEditId: string;
  version: number;
  affected: number;
  rowCount: number;
}
