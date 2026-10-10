/**
 * AFTER-COMMIT HOOKS: what a committed write tells the rest of the system, without lib/artifacts
 * knowing who listens. A head commit (a creation, an edit, a re-rendering) and a dataset write each
 * emit one event; lib/publish registers the listeners that warm the new head's prepared page and
 * invalidate the guest snapshots a dataset feeds (lib/publish/prepared/commit-hooks.server
 * installStoryCommitHooks, called by the serving composition). Nothing registered means nothing runs:
 * a script or a unit test that writes gets no background work behind its back.
 *
 * THE CONTRACT.
 *  - An emitter is called only AFTER the write's transaction committed. It takes no `Queryable`, so a
 *    caller holding a transaction has nothing to hand it — the PGLite rule in AGENTS.md: one serialized
 *    connection per process, notifications and telemetry after commit, atomic edits preserved. A
 *    `pg_notify` stays inside its transaction, where Postgres delivers it on commit; this is not that.
 *  - An emitter runs each listener synchronously, in registration order. It never awaits and never
 *    throws: a listener that throws is reported with `console.warn` and the next one still runs.
 *  - A listener is synchronous and owns its own async failures: a promise it starts must carry its
 *    own `.catch`, because the emitter does not wait for it and cannot see it reject.
 */
import type { ArtifactRow } from './table';

/** What changed at the head beyond its content: `renderingChanged`, its stored rendering (diagrams drawn after it was prepared). */
interface HeadChange { renderingChanged?: boolean }
/** `row`: the head as the emitter already read and decoded it, when it has it, so a listener need not read it again. */
type HeadCommittedListener = (id: string, row?: ArtifactRow, change?: HeadChange) => void;
type DatasetCommittedListener = (id: string) => void;

const headListeners = new Set<HeadCommittedListener>();
const datasetListeners = new Set<DatasetCommittedListener>();

function subscribe<T>(listeners: Set<T>, fn: T): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** One listener, run now; what it throws is reported, never passed to the write that emitted. */
function guarded(event: string, id: string, run: () => void): void {
  try { run(); } catch (error) { console.warn(`[after-commit] a ${event} listener failed`, id, error); }
}

/** Listen for every committed head. Returns the listener's disposer. */
export const onHeadCommitted = (fn: HeadCommittedListener): (() => void) => subscribe(headListeners, fn);
/** Listen for every committed dataset write. Returns the listener's disposer. */
export const onDatasetCommitted = (fn: DatasetCommittedListener): (() => void) => subscribe(datasetListeners, fn);

/** A head committed: a creation, an edit, or (with `renderingChanged`) a re-rendering of the same version. */
export function emitHeadCommitted(id: string, row?: ArtifactRow, change?: HeadChange): void {
  for (const fn of [...headListeners]) guarded('head', id, () => fn(id, row, change));
}

/** A dataset write committed: whatever read this dataset may now be stale. */
export function emitDatasetCommitted(id: string): void {
  for (const fn of [...datasetListeners]) guarded('dataset', id, () => fn(id));
}
