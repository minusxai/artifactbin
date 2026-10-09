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
 * backend are whatever the owner holds at the moment of use — a Solid caller hands its
 * props proxy. The `initial*` fields are read once, at creation.
 */
import type { DocumentGraph } from '@artifactbin/contracts';
import { advanceBrowserDocument, prepareBrowserDocumentUpdate, preparesOffThread, warmBrowserPreparer } from '@/lib/document/document-authoring-client';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { combineAnnotationOperations, type AnnotationOperation } from '@/lib/editor-v2/annotation-map';
import { rebaseEditBatch } from '@/lib/document/edit-batch';
import { sourceChanges } from '@/lib/editor-v2/history';
import { sourceEdits } from '@/lib/editor-v2/source-edits';

/** How long a burst of typing coalesces before it is persisted. */
const FLUSH_DEBOUNCE_MS = 500;
/** How long after editing starts the save worker is warmed (the graph posted, one preparation run): after the editors mount. */
const WARM_PREPARER_MS = 1500;
/** How often a wait for the editor to go idle looks again. */
const IDLE_POLL_MS = 100;

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
  /**
   * Settles once the user has stopped: nothing buffered (the save's own quiet period has passed), no save on the
   * wire, no typing the editor has not committed. A remote document is FETCHED only then — it is the whole document,
   * megabytes landing on the page thread, and the editor would not adopt it before this anyway.
   */
  whenIdle(): Promise<void>;
  /**
   * "That head pointer is one WE produced" — lets the live stream drop our own echo instead of fetching the whole
   * document for it. Known the moment a save's reply lands, before it is applied (typing can hold that back for
   * seconds). While a save is on the wire its ping can overtake the reply: the answer is then a promise that settles
   * when the reply lands.
   */
  isOwnEdit(candidate: string): boolean | Promise<boolean>;
  /** The owner is gone: stop scheduling, and let an in-flight response land without side effects. */
  dispose(): void;
}

function refusedSaveMessage(error: string | undefined, status: number): string {
  if (status === 404 || error === 'not_found') {
    return 'Your editing access may have changed or the document may no longer be available. Copy your draft before refreshing.';
  }
  if (error === 'invalid_refs') {
    return 'One or more references could not be resolved. Check the references and try saving again.';
  }
  return 'The server could not save this change. Your draft is preserved.';
}

function requestFailureMessage(error: unknown, recovery = false): string {
  if (error instanceof TypeError) return 'Could not reach the server. Your draft is preserved; try again when connected.';
  if (recovery && error instanceof Error && /latest document/i.test(error.message)) {
    return 'Could not load the editable version. Copy your draft, then refresh to reopen the document.';
  }
  if (recovery) return 'Could not recover the editable version. Copy your draft, then refresh to reopen the document.';
  return error instanceof Error ? error.message : 'Document validation failed';
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
  /**
   * THE EDITOR LAGS THE SERVER while the user types. A save that lands on a head carrying a collaborator's change is
   * not shown at once: rebuilding the editor from the merged source is a long task on the page thread, mid-typing.
   * Until typing goes quiet the editor keeps showing `local` (its own source as of that save) while `baseSource` is
   * the server's `server`; every save in between is rebased from the editor's text onto the server's, and once quiet
   * the editor adopts `server` (which holds the user's saved text too) in one step.
   */
  let lag: { local: string; server: string } | null = null;
  let reconciling = false;
  let pending: PendingChange | null = null;
  /** The request on the wire, so a drain can wait for it rather than skip past it. */
  let inFlight: Promise<void> | null = null;
  let timer = 0;
  let navigationFlush = false;
  let failed = false;
  let failedChange: PendingChange | null = null;
  /** The pending change IS the failed one, re-queued for retry (offline) — not newer work. */
  let retryOwed = false;
  /** The head pointers this client's saves produced, newest last, recorded as each reply lands. */
  const ownEdits: string[] = [];
  /** Settles when the save on the wire has its reply (or failed); null when no save is on the wire. */
  let replied: Promise<void> | null = null;
  const isKnownOwn = (candidate: string) => candidate === editId || ownEdits.includes(candidate);

  const isUserEditing = () => options().isUserEditing?.() ?? false;
  // The first save of a session would otherwise post the whole graph to the worker and prepare cold (see warmBrowserPreparer).
  const warmTimer = typeof window === 'undefined' ? 0 : window.setTimeout(() => {
    const current = snapshot;
    if (!alive || pending || inFlight || !current.document) return;
    void warmBrowserPreparer({ ...current, document: current.document, title: current.meta.title as string | null, description: current.meta.description as string | null });
  }, WARM_PREPARER_MS);
  type Snapshot = typeof snapshot;
  type Prepared = Awaited<ReturnType<typeof prepareBrowserDocumentUpdate>>;
  const prepareChange = (backend: ArtifactBackend, current: Snapshot & { document: DocumentGraph }, change: PendingChange): Promise<Prepared> => {
    const { source, annotationOps, ...metadata } = change;
    return prepareBrowserDocumentUpdate(
      backend,
      { ...current, document: current.document, title: current.meta.title as string | null, description: current.meta.description as string | null },
      { source, annotationOps, metadata },
    );
  };
  /**
   * THE SAVE IS PREPARED WHILE THE DEBOUNCE RUNS. A queued change starts its preparation (in the worker, with its
   * authoring context) at once; the flush that follows the debounce sends that preparation when the change and the
   * snapshot it was prepared against are still the ones it is flushing, and prepares again otherwise. One runs at a
   * time: a change queued meanwhile is prepared when it finishes, the ones between are skipped. Only off the page
   * thread: without a worker a preparation is the page's own work, done once, at the flush.
   */
  let early: { change: PendingChange; snapshot: Snapshot; backend: ArtifactBackend; result: Promise<Prepared> } | null = null;
  let earlyRunning = false;
  let earlyAgain = false;
  const prepareEarly = () => {
    const change = pending;
    const current = snapshot;
    const backend = options().backend;
    if (!alive || !change || !current.document || inFlight || failed || !preparesOffThread()) return;
    if (early && early.change === change && early.snapshot === current && early.backend === backend) return;
    if (change.source !== undefined && baseSource !== undefined && change.source === baseSource && change.title === undefined && change.theme === undefined && change.colorMode === undefined && !change.annotationOps?.length) return;
    if (earlyRunning) { earlyAgain = true; return; }
    earlyRunning = true;
    const result = prepareChange(backend, { ...current, document: current.document }, change);
    early = { change, snapshot: current, backend, result };
    void result.catch(() => {}).finally(() => {
      earlyRunning = false;
      if (earlyAgain) { earlyAgain = false; prepareEarly(); }
    });
  };
  const onRemoteDocument = (source: string) => options().onRemoteDocument(source, editId);
  /** The editor's source (`local`) rebased onto the server's: the change the editor shows is lagging the head. */
  const rebaseOnServer = (source: string, current: { local: string; server: string }) => {
    const remote = sourceChanges(current.local, current.server).reverse().map((c, i) => ({ ...c, seq: i, editId }));
    return rebaseEditBatch(current.server, sourceChanges(current.local, source), remote);
  };

  const flush = async (): Promise<void> => {
    if (inFlight) return inFlight;
    const shown = pending;
    if (!shown) return;
    pending = null;
    failed = false;
    retryOwed = false;
    // What the editor shows is behind the head (see `lag`): send the change rebased onto the head.
    let change = shown;
    if (lag && shown.source !== undefined && baseSource !== undefined) {
      const merged = rebaseOnServer(shown.source, lag);
      if (!merged.ok) {
        failed = true;
        failedChange = shown;
        setState((s) => ({ ...s, status: 'not saved — newer typing conflicts with the accepted document', pending: false }));
        return;
      }
      change = { ...shown, source: merged.source };
    }
    const edits = change.source !== undefined && baseSource !== undefined ? sourceEdits(baseSource, change.source) : undefined;
    if (edits?.length === 0 && change.title === undefined && change.theme === undefined && change.colorMode === undefined) {
      failedChange = null;
      setState((s) => ({ ...s, pending: false, status: '' }));
      return;
    }
    const backend = options().backend;

    const run = (async () => {
      let prepared = false;
      try {
        const current = snapshot;
        if (!current.document) throw new Error('Refresh the document before saving.');
        const ready = early && early.change === change && change === shown && early.snapshot === current && early.backend === backend ? early.result : null;
        early = null;
        const documentUpdate = await (ready ?? prepareChange(backend, { ...current, document: current.document }, change));
        prepared = true;
        const request = backend.commitEdit({ edit_id: editId, document_update: documentUpdate });
        // Ours from the moment the reply lands, although applying it may wait (the graph advance, typing in
        // progress). Registered before the await below, so it has run by the time anything resumes on the reply.
        const reply: Promise<void> = request.then((answer) => {
          if (answer.ok && answer.body.edit_id) { ownEdits.push(answer.body.edit_id); if (ownEdits.length > 8) ownEdits.shift(); }
          if (replied === reply) replied = null;
        }, () => { if (replied === reply) replied = null; });
        replied = reply;
        const res = await request;
        const body = res.body;

        if (res.ok) {
          // The answer is the patch: advance the graph it was prepared against (off the page thread). When it landed on
          // a newer head the answer carries the patches of the versions between, replayed first, in order. Only when
          // those are missing (the log could not yield them) is the head read.
          let next: { document?: DocumentGraph; source?: string | null } = { document: body.document, source: body.markup };
          if (!body.document && body.patch) {
            const between = body.version === current.version + 1 ? [] : body.remote_patches;
            const steps = between && between.length === body.version - current.version - 1 && between.every((step, i) => step.version === current.version + 1 + i)
              ? [...between, { version: body.version, patch: body.patch }] : null;
            let graph: { document: DocumentGraph; source: string } | null = steps ? { document: current.document, source: '' } : null;
            for (const step of steps ?? []) { graph = await advanceBrowserDocument(graph!.document, step.version - 1, step.patch); if (!graph) break; }
            next = graph ?? {};
          }
          if (!next.document && body.patch) { const head = await backend.load().catch(() => null); next = { document: head?.document?.kind === 'graph' ? head.document : undefined, source: head?.markup }; }
          // Composition owns the DOM until commit. Keep this response in flight so subsequent typing
          // stays pending.
          while (alive && isUserEditing()) await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
          if (!alive) return;
          failedChange = null;
          editId = body.edit_id;
          snapshot = { document: next.document, version: body.version, meta: { title: body.title, theme: body.theme, template: body.template, colorMode: body.colorMode } };
          if (baseSource !== undefined && change.source !== undefined && shown.source !== undefined) {
            const accepted = next.source ?? change.source;
            // The editor shows `shown` (plus whatever was typed since): it lags the head until typing goes quiet.
            lag = accepted === shown.source ? null : { local: shown.source, server: accepted };
            baseSource = accepted;
            if (lag) reconcileWhenQuiet();
          }
          setState({
            editId: body.edit_id,
            version: body.version,
            status: '',
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
            status: first ? `not saved — ${first}${more > 0 ? ` (+${more} more)` : ''}` : `not saved — ${refusedSaveMessage(body.error, res.status)}`,
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
          status: prepared ? 'offline — will retry' : `not saved — ${requestFailureMessage(error)}`,
          pending: false,
        }));
      } finally {
        inFlight = null;
        // Anything queued while we were in flight (including a retry) drains now.
        if (alive && pending && !navigationFlush) {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => void flush(), FLUSH_DEBOUNCE_MS);
          prepareEarly();
        }
      }
    })();
    inFlight = run;
    // Only now say so: a listener this wakes (a remote document waiting for the editor to be idle) must see the
    // save in flight. Announced before `inFlight` was set, it saw an idle editor, adopted the remote document
    // under the save and rebased the save onto it — the remote edit was overwritten.
    setState((s) => ({ ...s, pending: true, status: 'saving…' }));
    return run;
  };

  const queue = (change: PendingChange) => {
    pending = { ...(pending ?? {}), ...change, annotationOps: combineAnnotationOperations(pending?.annotationOps, change.annotationOps) };
    setState((s) => ({ ...s, pending: true }));
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush(), change.annotationOps?.some((op) => op.kind === 'map') ? 0 : FLUSH_DEBOUNCE_MS);
    prepareEarly();
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
  const quiet = () => pending === null && inFlight === null && !isUserEditing();
  const whenIdle = (): Promise<void> => quiet() ? Promise.resolve() : new Promise<void>((resolve) => {
    const check = () => { if (!alive || quiet()) resolve(); else window.setTimeout(check, IDLE_POLL_MS); };
    window.setTimeout(check, IDLE_POLL_MS);
  });
  /**
   * Once typing goes quiet (everything typed is saved, nothing is uncommitted), the lagging editor adopts the head
   * in one step: the user's text is in it, and so is the collaborator's. A failed save keeps its draft: recovery decides.
   */
  function reconcileWhenQuiet(): void {
    if (reconciling) return;
    reconciling = true;
    void whenIdle().then(() => {
      reconciling = false;
      if (!alive || !lag || failedChange) return;
      if (!quiet()) { reconcileWhenQuiet(); return; }
      const target = lag.server;
      lag = null;
      onRemoteDocument(target);
    });
  }

  const adoptRemote: LiveEditsCore['adoptRemote'] = (remoteEditId, source, by = null, document, version, meta = {}) => {
    if (remoteEditId === editId || !isIdle() || isUserEditing()) return false;
    editId = remoteEditId;
    snapshot = { document, version: version ?? snapshot.version, meta };
    // Say WHO moved the document when the stream knows (a named collaborator).
    setState((s) => ({ ...s, editId: remoteEditId, status: by ? `updated by @${by}` : s.status }));
    if (baseSource !== undefined) baseSource = source;
    lag = null;
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
      // The draft is the editor's text: based on what the editor shows, which may lag the last accepted head.
      const shownBase = lag?.local ?? baseSource;
      if (mode === 'retry' && draft.source !== undefined && shownBase !== undefined) {
        const changes = sourceChanges(shownBase, remote.markup).reverse().map((c, i) => ({ ...c, seq: i, editId: remote.edit_id }));
        const merged = rebaseEditBatch(remote.markup, sourceChanges(shownBase, draft.source), changes);
        if (!merged.ok) {
          setState((s) => ({ ...s, status: 'not saved — overlapping edits need review; your draft is preserved', pending: false }));
          return;
        }
        next = merged.source;
      } else if (mode === 'retry' && draft.source !== undefined) next = draft.source;
      baseSource = remote.markup;
      lag = null;
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
      setState((s) => ({ ...s, status: `not saved — ${requestFailureMessage(error, true)}`, pending: false }));
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
    whenIdle,
    isOwnEdit: (candidate) => {
      if (isKnownOwn(candidate)) return true;
      const reply = replied;
      return reply ? reply.then(() => isKnownOwn(candidate)) : false;
    },
    dispose() {
      alive = false;
      window.clearTimeout(warmTimer);
      window.clearTimeout(timer);
    },
  };
}
