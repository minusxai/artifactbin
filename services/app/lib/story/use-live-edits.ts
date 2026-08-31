'use client';

/**
 * Save-less persistence for the editor: buffer local changes briefly, then
 * flush them through the concurrent-edit protocol, and absorb remote changes
 * while idle.
 *
 * There is no Save button and no draft state — buffering exists only so a
 * burst of typing becomes one request. The buffer is a PERFORMANCE device, so
 * it is bounded in time (not in size) and always drains.
 *
 * Concurrency lives in the protocol, not here: every flush carries the
 * `edit_id` this client last saw, so an edit to a different node applies even
 * though the base is stale, and only a change to the SAME node comes back as
 * `doc_changed`. On that rejection the remote document wins — the local edit
 * is at most one flush interval old, and silently keeping it would mean
 * showing the user a document nobody else has.
 */
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
  source?: string;
  title?: string | null;
  theme?: string | null;
  colorMode?: 'light' | 'dark' | null;
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

export interface UseLiveEditsOptions {
  id: string;
  initialEditId: string;
  initialVersion: number;
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

export function useLiveEdits({ id, initialEditId, initialVersion, onRemoteDocument, isUserEditing }: UseLiveEditsOptions) {
  const [state, setState] = useState<LiveEditState>({
    editId: initialEditId,
    version: initialVersion,
    status: '',
    pending: false,
  });

  const editIdRef = useRef(initialEditId);
  const pendingRef = useRef<PendingChange | null>(null);
  /** The request on the wire, so a drain can wait for it rather than skip past it. */
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef(0);

  const endpoint = `/api/my/artifacts/${id}/edits`;
  const flush = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    const change = pendingRef.current;
    if (!change) return;
    pendingRef.current = null;
    setState((s) => ({ ...s, pending: true, status: 'saving…' }));

    const run = (async () => {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edit_id: editIdRef.current,
          ...(change.source !== undefined ? { source: change.source } : {}),
          ...(change.title !== undefined ? { title: change.title } : {}),
          ...(change.theme !== undefined ? { theme: change.theme } : {}),
          ...(change.colorMode !== undefined ? { colorMode: change.colorMode } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as FlushResponse;

      if (res.ok) {
        editIdRef.current = body.edit_id;
        setState({ editId: body.edit_id, version: body.version, status: '', pending: false });
      } else if (res.status === 409 && body.edit_id) {
        // Same node changed under us. Take the server's document — ours is at
        // most one flush old, and diverging silently is worse than losing it.
        editIdRef.current = body.edit_id;
        if (typeof body.source === 'string') onRemoteDocument(body.source);
        setState((s) => ({ ...s, editId: body.edit_id, status: 'synced with a change from elsewhere', pending: false }));
      } else if (body.detail === 'identical') {
        // The flush carried no real change (e.g. a blur that committed nothing).
        setState((s) => ({ ...s, status: '', pending: false }));
      } else {
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
      // Offline or a dropped request: keep the change and let the next tick retry.
      pendingRef.current = { ...change, ...(pendingRef.current ?? {}) };
      setState((s) => ({ ...s, status: 'offline — will retry', pending: false }));
    } finally {
      inFlightRef.current = null;
      // Anything queued while we were in flight (including a retry) drains now.
      if (pendingRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => void flush(), FLUSH_DEBOUNCE_MS);
      }
    }
    })();
    inFlightRef.current = run;
    return run;
  }, [endpoint, onRemoteDocument]);

  /** Queue a change; it persists on its own within one debounce window. */
  const queue = useCallback((change: PendingChange) => {
    pendingRef.current = { ...(pendingRef.current ?? {}), ...change };
    setState((s) => ({ ...s, pending: true }));
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), FLUSH_DEBOUNCE_MS);
  }, [flush]);

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
    } while (pendingRef.current || inFlightRef.current);
  }, [flush]);

  /** True when nothing is queued and nothing is in flight. */
  const isIdle = useCallback(() => pendingRef.current === null && inFlightRef.current === null, []);

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
  const adoptRemote = useCallback((remoteEditId: string, source: string, by: string | null = null) => {
    if (remoteEditId === editIdRef.current || !isIdle() || isUserEditing?.()) return false;
    editIdRef.current = remoteEditId;
    // Say WHO moved the document when the stream knows (a named collaborator);
    // an agent or an anonymous writer has no handle and the chip stays quiet.
    setState((s) => ({ ...s, editId: remoteEditId, status: by ? `updated by @${by}` : s.status }));
    onRemoteDocument(source);
    return true;
  }, [isIdle, isUserEditing, onRemoteDocument]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return { state, queue, flushNow, adoptRemote, isIdle, isOwnEdit };
}
