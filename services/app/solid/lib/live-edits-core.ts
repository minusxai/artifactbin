/**
 * Save-less persistence for the editor, FRAMEWORK-FREE: buffer local changes briefly, then flush
 * them through the concurrent-edit protocol, and absorb remote changes while idle.
 *
 * The Solid primitive (solid/editor/create-live-edits) provides a subscription and a lifetime around it.
 *
 * Successful typing is briefly batched without a Save button. Failed writes retain a recoverable
 * draft and block navigation until retried or explicitly discarded. The normal buffer drains after a
 * short debounce.
 *
 * Concurrency lives in the protocol, not here: every flush carries the `edit_id` this client last
 * saw, so an edit to a different node applies even though the base is stale, and only a change to
 * the SAME node comes back as `doc_changed`. On rejection, keep the local draft and block navigation
 * until it is saved or the user explicitly recovers the remote version.
 *
 * Options are read LIVE through a getter: callbacks (`onRemoteDocument`, `isUserEditing`) and the
 * backend are whatever the owner holds at the moment of use — React hands its latest props, Solid its
 * props proxy. The `initial*` fields are read once, at creation, as the hook's `useRef(initial)` did.
 */
import type { DocumentGraph, DocumentAssetWarning } from '@artifactbin/contracts';
import { prepareBrowserDocumentUpdate } from '@/lib/story/document-authoring-client';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { combineAnnotationOperations, type AnnotationOperation } from '@/lib/editor-v2/annotation-map';
import { rebaseEditBatch } from '@/lib/story/edit-batch';
import { sourceChanges } from '@/lib/editor-v2/history';
import { sourceEdits } from '@/lib/editor-v2/source-edits';

/** How long a burst of typing coalesces before it is persisted. */
export const FLUSH_DEBOUNCE_MS = 500;

export interface LiveEditState {
  /** Head pointer this client is based on — every flush carries it. */
  editId: string;
  version: number;
  /** Short human-readable state for the status line ('' when idle and clean). */
  status: string;
  /** True while a flush is in flight or pending. */
  pending: boolean;
}

export interface PendingChange {
  annotationOps?: AnnotationOperation[];
  source?: string;
  title?: string | null;
  theme?: string | null;
  colorMode?: 'light' | 'dark' | null;
}

export interface LiveEditsOptions {
  /** Where edits are committed and the head is re-read (lib/artifact-backend). */
  backend: ArtifactBackend;
  initialEditId: string;
  initialVersion: number;
  initialDocument?: DocumentGraph;
  initialMetadata?: Record<string, unknown>;
  /** V2 snapshots lower to atomic source batches against this acknowledged base. */
  initialSource?: string;
  /** Called when the server's document should replace what the editor shows. */
  onRemoteDocument: (source: string, editId: string) => void;
  /**
   * True while the user is mid-edit with changes the editor has not committed yet. An empty buffer
   * is NOT enough to call the editor idle: the engine commits a text edit on BLUR, so adopting a
   * remote document in that window would remount the canvas and destroy their typing.
   */
  isUserEditing?: () => boolean;
}

export interface LiveEditsCore {
  getState(): LiveEditState;
  /** Called with every new state object (never mutated in place). Returns the unsubscribe. */
  subscribe(listener: (state: LiveEditState) => void): () => void;
  /** Queue a change; it persists on its own within one debounce window. */
  queue(change: PendingChange): void;
  /** Persist EVERYTHING owed now: loop until nothing is pending and nothing is in flight. */
  flushNow(): Promise<void>;
  /** A route leave is stricter than background sync: never discard a failed draft. */
  flushForNavigation(commit: () => Promise<void>): Promise<boolean>;
  /** Adopt a remote frame only when there is nothing local to lose. */
  adoptRemote(remoteEditId: string, source: string, by?: string | null, document?: DocumentGraph, version?: number, meta?: Record<string, unknown>): boolean;
  /** Explicit recovery: retry rebases the retained draft; server discards only after user choice. */
  recover(mode: 'retry' | 'server'): Promise<void>;
  /** True when nothing is queued, nothing is in flight and no failed draft is retained. */
  isIdle(): boolean;
  /** "That head pointer is one WE produced" — lets the live stream drop our own echo early. */
  isOwnEdit(candidate: string): boolean;
  /** The owner is gone: stop scheduling, and let an in-flight response land without side effects. */
  dispose(): void;
}

function mergePending(first: PendingChange | null, second: PendingChange | null): PendingChange {
  return {
    ...first,
    ...second,
    annotationOps: combineAnnotationOperations(first?.annotationOps, second?.annotationOps),
  };
}

export function createLiveEditsCore(options: () => LiveEditsOptions): LiveEditsCore {
  const initial = options();
  let state: LiveEditState = { editId: initial.initialEditId, version: initial.initialVersion, status: '', pending: false };
  const listeners = new Set<(state: LiveEditState) => void>();
  const setState = (next: LiveEditState | ((s: LiveEditState) => LiveEditState)) => {
    state = typeof next === 'function' ? next(state) : next;
    for (const listener of listeners) listener(state);
  };

  let alive = true;
  let editId = initial.initialEditId;
  let snapshot: { document?: DocumentGraph; version: number; meta: Record<string, unknown> } = {
    document: initial.initialDocument, version: initial.initialVersion, meta: initial.initialMetadata ?? {},
  };
  let baseSource = initial.initialSource;
  let pending: PendingChange | null = null;
  /** The request on the wire, so a drain can wait for it rather than skip past it. */
  let inFlight: Promise<void> | null = null;
  let timer = 0;
  let navigationFlush = false;
  let failed = false;
  let failedChange: PendingChange | null = null;
  /** The pending change IS the failed one, re-queued for retry (offline) — not newer work. */
  let retryOwed = false;

  const isUserEditing = () => options().isUserEditing?.() ?? false;
  const onRemoteDocument = (source: string) => options().onRemoteDocument(source, editId);

  const flush = async (): Promise<void> => {
    if (inFlight) return inFlight;
    const change = pending;
    if (!change) return;
    pending = null;
    failed = false;
    retryOwed = false;
    const edits = change.source !== undefined && baseSource !== undefined ? sourceEdits(baseSource, change.source) : undefined;
    if (edits?.length === 0 && change.title === undefined && change.theme === undefined && change.colorMode === undefined) {
      failedChange = null;
      setState((s) => ({ ...s, pending: false, status: '' }));
      return;
    }
    setState((s) => ({ ...s, pending: true, status: 'saving…' }));
    const backend = options().backend;

    const run = (async () => {
      let prepared = false;
      try {
        const current = snapshot;
        if (!current.document) throw new Error('Refresh the document before saving.');
        const { source, annotationOps, ...metadata } = change;
        let warnings: DocumentAssetWarning[] = [];
        const documentUpdate = await prepareBrowserDocumentUpdate(
          backend,
          { ...current, document: current.document, title: current.meta.title as string | null, description: current.meta.description as string | null },
          { source, annotationOps, metadata },
          (received) => { warnings = received; },
        );
        prepared = true;
        const res = await backend.commitEdit({ edit_id: editId, document_update: documentUpdate });
        const body = res.body;

        if (res.ok) {
          // Composition owns the DOM until commit. Keep this response in flight so subsequent typing
          // stays pending, then rebase the complete local draft.
          while (alive && isUserEditing()) await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
          if (!alive) return;
          failedChange = null;
          editId = body.edit_id;
          snapshot = { document: body.document, version: body.version, meta: { title: body.title, theme: body.theme, template: body.template, colorMode: body.colorMode } };
          if (baseSource !== undefined && change.source !== undefined) {
            const accepted = body.markup ?? change.source;
            const queued = pending as PendingChange | null;
            if (accepted !== change.source) {
              if (queued?.source !== undefined) {
                const remote = sourceChanges(change.source, accepted).reverse().map((c, i) => ({ ...c, seq: i, editId: body.edit_id }));
                const merged = rebaseEditBatch(accepted, sourceChanges(change.source, queued.source), remote);
                if (!merged.ok) {
                  failed = true;
                  failedChange = queued;
                  pending = null;
                  baseSource = accepted;
                  setState((s) => ({ ...s, editId: body.edit_id, status: 'not saved — newer typing conflicts with the accepted document', pending: false }));
                  return;
                }
                queued.source = merged.source;
                onRemoteDocument(merged.source);
              } else if (!isUserEditing()) onRemoteDocument(accepted);
            }
            baseSource = accepted;
          }
          setState({
            editId: body.edit_id,
            version: body.version,
            status: warnings.length ? `saved — ${warnings[0]!.fix}${warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}` : '',
            pending: false,
          });
        } else if (body.detail === 'identical') {
          failedChange = null;
          // The flush carried no real change (e.g. a blur that committed nothing).
          setState((s) => ({ ...s, status: '', pending: false }));
        } else {
          failed = true;
          failedChange = mergePending(change, pending);
          // Say WHAT is wrong (the door's own diagnostic), one at a time; the rest are counted.
          const first = body.details?.find((d) => typeof d?.message === 'string')?.message;
          const more = (body.details?.length ?? 0) - 1;
          setState((s) => ({
            ...s,
            status: first ? `not saved — ${first}${more > 0 ? ` (+${more} more)` : ''}` : `not saved (${body.error ?? res.status})`,
            pending: false,
          }));
        }
      } catch (error) {
        failed = true;
        failedChange = mergePending(change, pending);
        // Offline or a dropped request: keep the change and let the next tick retry. A REFUSAL (the
        // authoring door said the document is invalid) is not retried as-is — but anything queued
        // while it was on the wire is newer work and still goes out.
        retryOwed = prepared;
        if (prepared) pending = mergePending(change, pending);
        setState((s) => ({
          ...s,
          status: prepared ? 'offline — will retry' : `not saved — ${error instanceof Error ? error.message : 'Document validation failed'}`,
          pending: false,
        }));
      } finally {
        inFlight = null;
        // Anything queued while we were in flight (including a retry) drains now.
        if (alive && pending && !navigationFlush) {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => void flush(), FLUSH_DEBOUNCE_MS);
        }
      }
    })();
    inFlight = run;
    return run;
  };

  const queue = (change: PendingChange) => {
    pending = { ...(pending ?? {}), ...change, annotationOps: combineAnnotationOperations(pending?.annotationOps, change.annotationOps) };
    setState((s) => ({ ...s, pending: true }));
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush(), change.annotationOps?.some((op) => op.kind === 'map') ? 0 : FLUSH_DEBOUNCE_MS);
  };

  const flushNow = async () => {
    do {
      window.clearTimeout(timer);
      await (inFlight ?? flush());
      // A failure stops the drain unless newer work is queued behind it: that work is sent (it may be
      // the very edit that fixes a refused state), but re-sending the same offline change would spin.
      if (failed && (retryOwed || !pending)) break;
    } while (pending || inFlight);
  };

  const flushForNavigation = async (commit: () => Promise<void>): Promise<boolean> => {
    navigationFlush = true;
    try {
      window.clearTimeout(timer);
      await commit();
      if (failedChange) pending = mergePending(failedChange, pending);
      failedChange = null;
      await flushNow();
      return !failed && !pending && !inFlight;
    } catch {
      setState((s) => ({ ...s, status: 'not saved — editor did not finish; retry navigation', pending: false }));
      return false;
    } finally {
      navigationFlush = false;
    }
  };

  const isIdle = () => pending === null && inFlight === null && failedChange === null;

  const adoptRemote: LiveEditsCore['adoptRemote'] = (remoteEditId, source, by = null, document, version, meta = {}) => {
    if (remoteEditId === editId || !isIdle() || isUserEditing()) return false;
    editId = remoteEditId;
    snapshot = { document, version: version ?? snapshot.version, meta };
    // Say WHO moved the document when the stream knows (a named collaborator).
    setState((s) => ({ ...s, editId: remoteEditId, status: by ? `updated by @${by}` : s.status }));
    if (baseSource !== undefined) baseSource = source;
    onRemoteDocument(source);
    return true;
  };

  const recover = async (mode: 'retry' | 'server') => {
    window.clearTimeout(timer);
    if (inFlight) await inFlight;
    const draft = mergePending(failedChange, pending);
    try {
      const remote = await options().backend.load();
      if (!remote) throw Error('Could not read the latest document.');
      if (typeof remote.markup !== 'string' || !remote.edit_id) throw Error('The latest document is unavailable.');
      let next = remote.markup;
      if (mode === 'retry' && draft.source !== undefined && baseSource !== undefined) {
        const changes = sourceChanges(baseSource, remote.markup).reverse().map((c, i) => ({ ...c, seq: i, editId: remote.edit_id }));
        const merged = rebaseEditBatch(remote.markup, sourceChanges(baseSource, draft.source), changes);
        if (!merged.ok) {
          setState((s) => ({ ...s, status: 'not saved — overlapping edits need review; your draft is preserved', pending: false }));
          return;
        }
        next = merged.source;
      } else if (mode === 'retry' && draft.source !== undefined) next = draft.source;
      baseSource = remote.markup;
      editId = remote.edit_id;
      snapshot = { document: remote.document, version: remote.version, meta: { title: remote.title, theme: remote.theme, template: remote.template, colorMode: remote.colorMode } };
      pending = null;
      failedChange = null;
      failed = false;
      setState({ editId: remote.edit_id, version: remote.version, status: '', pending: false });
      onRemoteDocument(next);
      if (mode === 'retry') {
        pending = { ...draft, source: next };
        await flush();
      }
    } catch (error) {
      setState((s) => ({ ...s, status: `not saved — ${error instanceof Error ? error.message : 'recovery failed'}`, pending: false }));
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    queue,
    flushNow,
    flushForNavigation,
    adoptRemote,
    recover,
    isIdle,
    isOwnEdit: (candidate) => candidate === editId,
    dispose() {
      alive = false;
      window.clearTimeout(timer);
    },
  };
}
