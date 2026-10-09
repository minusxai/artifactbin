/**
 * STORY'S AFTER-COMMIT LISTENERS. lib/artifacts announces committed writes (lib/artifacts/after-commit) and
 * never imports story; story answers here. The serving composition (server/app createAppServer) installs them,
 * once: a process that writes without serving — a script, a unit test — registers nothing and gets no
 * background work, and its readers still miss and write back.
 *
 *  - A head committed: prepare it for its first reader (prepared-page.server warmPreparedPage). A head whose
 *    rendering changed (diagrams drawn after it was prepared, lib/mermaid-images/harvester) drops its stored
 *    page first, so it is prepared again with them.
 *  - A dataset committed: flag the guest snapshots that read it and queue their heads' revalidation
 *    (snapshots.server). Never awaited, never failing the write: freshness is decided on read by the marks.
 *
 * Listeners are synchronous and own their failures (the after-commit contract): the warm-up queue swallows its
 * own, and the invalidation carries its own `.catch`.
 */
import { onDatasetCommitted, onHeadCommitted } from '@/lib/artifacts/after-commit';
import { enableBackgroundRestyles, warmPreparedPage } from './prepared-page.server';
import { snapshotStore } from './snapshots.server';

let installed = false;

/** Register story's after-commit listeners and its background re-preparation. Idempotent. */
export function installStoryCommitHooks(): void {
  if (installed) return;
  installed = true;
  enableBackgroundRestyles();
  onHeadCommitted((id, row, change) => warmPreparedPage(id, row, { replace: change?.renderingChanged }));
  onDatasetCommitted((id) => {
    void snapshotStore.invalidate(id).catch((error) => console.warn('[snapshots] invalidate failed', id, error));
  });
}
