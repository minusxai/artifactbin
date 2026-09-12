'use client';

/**
 * Save-less persistence for the editor: buffer local changes briefly, then
 * flush them through the concurrent-edit protocol, and absorb remote changes
 * while idle.
 *
 * Successful typing is briefly batched without a Save button. Failed writes
 * retain a recoverable draft and block navigation until retried or explicitly
 * discarded. The normal buffer drains after a short debounce.
 *
 * Concurrency lives in the protocol, not here: every flush carries the
 * `edit_id` this client last saw, so an edit to a different node applies even
 * though the base is stale, and only a change to the SAME node comes back as
 * `doc_changed`. On rejection, keep the local draft and block navigation until it is saved
 * or the user explicitly recovers the remote version.
 */
import {writeBrowserArtifact} from '@/lib/browser-artifact-write';
import { combineAnnotationOperations, type AnnotationOperation } from '@/lib/editor-v2/annotation-map';
import { rebaseEditBatch } from '@/lib/story/edit-batch';
import { sourceChanges } from '@/lib/editor-v2/history';
import { sourceEdits } from '@/lib/editor-v2/source-edits';
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a burst of typing coalesces before it is persisted. */
const FLUSH_DEBOUNCE_MS = 500;

/**
 * A page-held handle to "drain everything owed, now", filled by whichever
 * editor is mounted and called by the page before it unmounts one.
 *
 * It exists because the buffer above is a TIMER living inside the editor, and
 * not every way out of edit mode goes through the editor's own done button:
 * `#edit` is a history entry, so the browser's back button leaves by
 * unmounting the component — which cancels the very save it was about to make.
 * The page cannot know what is buffered; the editor cannot know it is about to
 * be removed. This is the seam between them.
 */
export interface EditorFlushRef {
  current: (() => Promise<void>) | null;
}

interface LiveEditState {
  /** Head pointer this client is based on — every flush carries it. */
  editId: string;
  version: number;
  /** Short human-readable state for the status line ('' when idle and clean). */
  status: string;
  /** True while a flush is in flight or pending. */
  pending: boolean;
}

interface PendingChange {
  annotationOps?: AnnotationOperation[];
  source?: string;
  title?: string | null;
  theme?: string | null;
  colorMode?: 'light' | 'dark' | null;
}

function mergePending(first: PendingChange | null, second: PendingChange | null): PendingChange {
  return {
    ...first,
    ...second,
    annotationOps: combineAnnotationOperations(first?.annotationOps, second?.annotationOps),
  };
}

interface FlushResponse {
  edit_id: string;
  version: number;
  markup: string | null;
  error?: string;
  /** The validator's own diagnostics — precise enough for the author to act on. */
  details?: Array<{ message?: string }>;
  source?: string;
  detail?: string;
}

interface UseLiveEditsOptions {
  id: string;
  initialEditId: string;
  initialVersion: number;
  /** V2 snapshots lower to atomic source batches against this acknowledged base. */
  initialSource?: string;
  /** Called when the server's document should replace what the editor shows. */
  onRemoteDocument: (source: string) => void;
  /**
   * True while the user is mid-edit with changes the editor has not committed
   * yet. An empty buffer is NOT enough to call the editor idle: the engine
   * commits a text edit on BLUR, so between the first keystroke and the blur
   * there is real work that exists only in the DOM. Adopting a remote document
   * in that window remounts the canvas and silently destroys their typing.
   */
  isUserEditing?: () => boolean;
}

export function useLiveEdits({
  id,
  initialEditId,
  initialVersion,
  initialSource,
  onRemoteDocument,
  isUserEditing,
}: UseLiveEditsOptions) {
  const [state, setState] = useState<LiveEditState>({
    editId: initialEditId,
    version: initialVersion,
    status: '',
    pending: false,
  });

  const aliveRef = useRef(true);
  const editIdRef = useRef(initialEditId);
  const baseSourceRef = useRef(initialSource);
  const pendingRef = useRef<PendingChange | null>(null);
  /** The request on the wire, so a drain can wait for it rather than skip past it. */
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef(0);
  const navigationFlush = useRef(false);
  const failedRef = useRef(false);
  const failedChangeRef = useRef<PendingChange | null>(null);

  const endpoint = `/api/my/artifacts/${id}/edits`;
  const flush = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    const change = pendingRef.current;
    if (!change) return;
    pendingRef.current = null;
    failedRef.current = false;
    const edits =
      change.source !== undefined && baseSourceRef.current !== undefined
        ? sourceEdits(baseSourceRef.current, change.source)
        : undefined;
    if (
      edits?.length === 0 &&
      change.title === undefined &&
      change.theme === undefined &&
      change.colorMode === undefined
    ) {
      failedChangeRef.current = null;
      setState((s) => ({ ...s, pending: false, status: '' }));
      return;
    }
    setState((s) => ({ ...s, pending: true, status: 'saving…' }));

    const run = (async () => {
      try {
        const metadata=change.title!==undefined||change.theme!==undefined||change.colorMode!==undefined;
        const res = metadata ? await writeBrowserArtifact(id,{...change},editIdRef.current) : await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            edit_id: editIdRef.current,
            ...(change.annotationOps?.length ? { annotation_ops: change.annotationOps } : {}),
            ...(edits
              ? edits.length
                ? { edits: edits.map((edit) => ({ old_string: edit.oldString, new_string: edit.newString })) }
                : {}
              : change.source !== undefined
                ? { source: change.source }
                : {}),
            ...(change.title !== undefined ? { title: change.title } : {}),
            ...(change.theme !== undefined ? { theme: change.theme } : {}),
            ...(change.colorMode !== undefined ? { colorMode: change.colorMode } : {}),
          }),
        });
        const body = (await res.json().catch(() => ({}))) as FlushResponse;

        if (res.ok) {
          // Composition owns the DOM until commit. Keep this response in flight so
          // subsequent typing stays pending, then rebase the complete local draft.
          while (aliveRef.current && isUserEditing?.())
            await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
          if (!aliveRef.current) return;
          failedChangeRef.current = null;
          editIdRef.current = body.edit_id;
          if (baseSourceRef.current !== undefined && change.source !== undefined) {
            const accepted = body.markup ?? change.source;
            const pending = pendingRef.current as PendingChange | null;
            if (accepted !== change.source) {
              if (pending?.source !== undefined) {
                const remote = sourceChanges(change.source, accepted)
                  .reverse()
                  .map((c, i) => ({ ...c, seq: i, editId: body.edit_id }));
                const merged = rebaseEditBatch(accepted, sourceChanges(change.source, pending.source), remote);
                if (!merged.ok) {
                  failedRef.current = true;
                  failedChangeRef.current = pending;
                  pendingRef.current = null;
                  baseSourceRef.current = accepted;
                  setState((s) => ({
                    ...s,
                    editId: body.edit_id,
                    status: 'not saved — newer typing conflicts with the accepted document',
                    pending: false,
                  }));
                  return;
                }
                pending.source = merged.source;
                onRemoteDocument(merged.source);
              } else if (!isUserEditing?.()) onRemoteDocument(accepted);
            }
            baseSourceRef.current = accepted;
          }
          setState({ editId: body.edit_id, version: body.version, status: '', pending: false });
        } else if (body.detail === 'identical') {
          failedChangeRef.current = null;
          // The flush carried no real change (e.g. a blur that committed nothing).
          setState((s) => ({ ...s, status: '', pending: false }));
        } else {
          failedRef.current = true;
          failedChangeRef.current = mergePending(change, pendingRef.current);
          /*
           * Say WHAT is wrong, not merely that something is. The door returns
           * self-correcting diagnostics ("a document may carry only one
           * <Helmet>") and the author is the one person who can act on them —
           * the error CLASS alone would leave them staring at `invalid_jsx`.
           *
           * One at a time: a document can fail many ways at once, and a wall of
           * them in a status chip is read as noise. The rest are counted.
           */
          const first = body.details?.find((d) => typeof d?.message === 'string')?.message;
          const more = (body.details?.length ?? 0) - 1;
          setState((s) => ({
            ...s,
            status: first
              ? `not saved — ${first}${more > 0 ? ` (+${more} more)` : ''}`
              : `not saved (${body.error ?? res.status})`,
            pending: false,
          }));
        }
      } catch {
        failedRef.current = true;
        failedChangeRef.current = mergePending(change, pendingRef.current);
        // Offline or a dropped request: keep the change and let the next tick retry.
        pendingRef.current = mergePending(change, pendingRef.current);
        setState((s) => ({ ...s, status: 'offline — will retry', pending: false }));
      } finally {
        inFlightRef.current = null;
        // Anything queued while we were in flight (including a retry) drains now.
        if (aliveRef.current && pendingRef.current && !navigationFlush.current) {
          window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => void flush(), FLUSH_DEBOUNCE_MS);
        }
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [endpoint, onRemoteDocument, isUserEditing]);

  /** Queue a change; it persists on its own within one debounce window. */
  const queue = useCallback(
    (change: PendingChange) => {
      pendingRef.current = {
        ...(pendingRef.current ?? {}),
        ...change,
        annotationOps: combineAnnotationOperations(pendingRef.current?.annotationOps, change.annotationOps),
      };
      setState((s) => ({ ...s, pending: true }));
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(
        () => void flush(),
        change.annotationOps?.some((op) => op.kind === 'map') ? 0 : FLUSH_DEBOUNCE_MS,
      );
    },
    [flush],
  );

  /**
   * Persist immediately (leaving edit mode, closing the tab, commenting on
   * the paragraph being typed in) — and EVERYTHING owed, not only what is
   * idle. `flush` yields to a request already on the wire, so a drain that
   * called it once resolved while the typing committed a moment ago still
   * sat in the buffer waiting for its debounce; the comment's anchor then
   * moved the head, the late text flush met a 409, and the editor adopted
   * the server's document over the words. Loop until nothing is pending
   * and nothing is in flight.
   */
  const flushNow = useCallback(async () => {
    do {
      window.clearTimeout(timerRef.current);
      await (inFlightRef.current ?? flush());
      if (failedRef.current) break;
    } while (pendingRef.current || inFlightRef.current);
  }, [flush]);

  /** A route leave is stricter than background sync: never discard a failed draft. */
  const flushForNavigation = useCallback(
    async (commit: () => Promise<void>): Promise<boolean> => {
      navigationFlush.current = true;
      try {
        window.clearTimeout(timerRef.current);
        await commit();
        if (failedChangeRef.current) pendingRef.current = mergePending(failedChangeRef.current, pendingRef.current);
        failedChangeRef.current = null;
        await flushNow();
        return !failedRef.current && !pendingRef.current && !inFlightRef.current;
      } catch {
        setState((s) => ({ ...s, status: 'not saved — editor did not finish; retry navigation', pending: false }));
        return false;
      } finally {
        navigationFlush.current = false;
      }
    },
    [flushNow],
  );

  /** True when nothing is queued and nothing is in flight. */
  const isIdle = useCallback(
    () => pendingRef.current === null && inFlightRef.current === null && failedChangeRef.current === null,
    [],
  );

  /**
   * "That head pointer is one WE produced" — every accepted write hands back a
   * fresh `edit_id`, and the same write also wakes the live stream, which sends
   * the whole document straight back to us. `adoptRemote` below already refuses
   * that echo, but only after it has become React state and re-rendered the
   * editor; this lets the stream drop it a step earlier (see useLiveArtifact).
   *
   * Reads the REF, not the state: the flush advances the ref synchronously with
   * the response, while the matching `setState` lands whenever React gets to
   * it — and the echo can beat it.
   */
  const isOwnEdit = useCallback((candidate: string) => candidate === editIdRef.current, []);

  /**
   * A remote frame arrived: adopt it only when there is nothing local to lose
   * — no buffered change, no flush in flight, and no uncommitted typing.
   *
   * A frame refused here is simply dropped, never replayed later: it is a
   * SNAPSHOT, and by the time the user blurs, their own flush has landed and
   * the server sends a fresher frame containing both changes. Replaying the
   * stale one would undo the edit that was just made.
   */
  const adoptRemote = useCallback(
    (remoteEditId: string, source: string, by: string | null = null) => {
      if (remoteEditId === editIdRef.current || !isIdle() || isUserEditing?.()) return false;
      editIdRef.current = remoteEditId;
      // Say WHO moved the document when the stream knows (a named collaborator);
      // an agent or an anonymous writer has no handle and the chip stays quiet.
      setState((s) => ({ ...s, editId: remoteEditId, status: by ? `updated by @${by}` : s.status }));
      if (baseSourceRef.current !== undefined) baseSourceRef.current = source;
      onRemoteDocument(source);
      return true;
    },
    [isIdle, isUserEditing, onRemoteDocument],
  );

  /** Explicit recovery: retry rebases the retained draft; server discards only after user choice. */
  const recover = useCallback(
    async (mode: 'retry' | 'server') => {
      window.clearTimeout(timerRef.current);
      if (inFlightRef.current) await inFlightRef.current;
      const draft = mergePending(failedChangeRef.current, pendingRef.current);
      try {
        const response = await fetch(`/api/my/artifacts/${id}`);
        if (!response.ok) throw Error('Could not read the latest document.');
        const remote = (await response.json()) as FlushResponse;
        if (typeof remote.markup !== 'string' || !remote.edit_id) throw Error('The latest document is unavailable.');
        let next = remote.markup;
        if (mode === 'retry' && draft.source !== undefined && baseSourceRef.current !== undefined) {
          const changes = sourceChanges(baseSourceRef.current, remote.markup)
            .reverse()
            .map((c, i) => ({ ...c, seq: i, editId: remote.edit_id }));
          const merged = rebaseEditBatch(remote.markup, sourceChanges(baseSourceRef.current, draft.source), changes);
          if (!merged.ok) {
            setState((s) => ({
              ...s,
              status: 'not saved — overlapping edits need review; your draft is preserved',
              pending: false,
            }));
            return;
          }
          next = merged.source;
        } else if (mode === 'retry' && draft.source !== undefined) next = draft.source;
        baseSourceRef.current = remote.markup;
        editIdRef.current = remote.edit_id;
        pendingRef.current = null;
        failedChangeRef.current = null;
        failedRef.current = false;
        setState({ editId: remote.edit_id, version: remote.version, status: '', pending: false });
        onRemoteDocument(next);
        if (mode === 'retry') {
          pendingRef.current = { ...draft, source: next };
          await flush();
        }
      } catch (error) {
        setState((s) => ({
          ...s,
          status: `not saved — ${error instanceof Error ? error.message : 'recovery failed'}`,
          pending: false,
        }));
      }
    },
    [id, flush, onRemoteDocument],
  );

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      window.clearTimeout(timerRef.current);
    };
  }, []);

  return { state, queue, recover, flushNow, flushForNavigation, adoptRemote, isIdle, isOwnEdit };
}
