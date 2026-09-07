import type {DataflowState} from '@/lib/story/dataflow';

/** Select changed subscribed fields; null means no delivery. */
export function authorStateDelta(previous: DataflowState | null, next: DataflowState, names?: {values: readonly string[]; tables: readonly string[]}): Partial<DataflowState> | null {
  throw new Error('iframe-state: implement');
}
