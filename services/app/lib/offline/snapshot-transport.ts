/**
 * The runtime's QueryTransport inside an offline file: answers from the
 * snapshot instead of the server.
 *
 *  - A query whose parameters (directly or through the queries it reads) are
 *    all at the snapshot's base values answers with the base result.
 *  - Otherwise it answers with the variant whose values match on exactly
 *    those parameters.
 *  - With no matching variant it answers with an error for that query:
 *    OFFLINE_FILTER_REASON. It never throws into the UI.
 *  - `page` slices the same rows; there is no `mutate` (the store then shows
 *    its existing cannot-save state) and no `importImage`.
 */
import type { QueryTransport } from '@/lib/story-runtime/store';
import type { Dataflow } from '@/lib/story/dataflow';
import type { ArtifactFileSnapshot } from './file-format';

export function createSnapshotTransport(flow: Dataflow, snapshot: ArtifactFileSnapshot): QueryTransport {
  void flow; void snapshot;
  throw new Error('not implemented: createSnapshotTransport');
}

/** The Values whose controls must be disabled offline: every frozen Value. */
export function frozenValueNames(snapshot: ArtifactFileSnapshot): Set<string> {
  return new Set(snapshot.frozen);
}
