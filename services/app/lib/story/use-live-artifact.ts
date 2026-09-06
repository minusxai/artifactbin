'use client';

/**
 * Subscribe a mounted page to its artifact's live document
 * (`GET /a/<id>/events`).
 *
 * The server's first frame is always the current state, so this needs no
 * cursor and no reconciliation: whatever arrives IS the document. `EventSource`
 * reconnects on its own, and because reconnecting re-sends the current state,
 * a dropped connection self-heals — the same "durable rows are the truth,
 * wakeups are only pointers" contract the server side is built on.
 *
 * The hook returns null until a frame arrives that differs from what the page
 * was server-rendered with, so the first paint is never disturbed.
 *
 * Two things are tracked per CONNECTION rather than per accepted frame — the
 * highest version seen and the last stylesheet seen. Both are properties of
 * what the server has already sent (it omits an unchanged stylesheet, and it
 * builds frames asynchronously so they can overtake each other), so they must
 * keep counting even for frames this hook decides not to surface. See
 * `isOwnFrame`.
 */
import {appFetch as fetch} from '@/web/api-origin';
import {appEventSource} from '@/web/api-origin';
import { useEffect, useRef, useState } from 'react';
import type { AnnotationWire } from '@/lib/annotations';
import type { ArtifactDataEvent, ArtifactLiveEvent, ArtifactVersionPing } from '@/lib/story/live';
import { STORY_ANNOTATIONS_EVENT, STORY_DATA_EVENT } from '@/lib/story-runtime/contract';

export function useLiveArtifact(
  id: string,
  initialEditId: string,
  initialVersion: number,
  enabled = true,
  /**
   * "This frame is the echo of a write I made" — the editor's own accepted
   * writes come back down the stream carrying the whole document, and it has
   * already applied them locally. Without this they still had to become React
   * state and re-render the editor before being recognised and refused, once
   * per keystroke burst on a document that may be very large.
   *
   * Held in a ref, never a dependency: a caller that rebuilds this closure must
   * not tear down and re-open the stream.
   */
  isOwnFrame?: (editId: string) => boolean,
  /**
   * A DATASET under this document changed (a named `data` frame — see
   * app/a/[id]/events). A CALLBACK rather than returned state, and held in a
   * ref like `isOwnFrame`: nothing about the document has changed, so this
   * must not become React state that re-renders the page — the one consumer
   * forwards it into the frame, which re-runs the affected queries in place.
   */
  onData?: (event: ArtifactDataEvent) => void,
  /**
   * The ANNOTATIONS on this document changed (a named frame the server sends
   * only on owner-credentialed connections — app/a/[id]/events). Same ref
   * treatment as `onData`; the payload is the full open list, so the consumer
   * replaces, never merges.
   */
  onAnnotations?: (annotations: AnnotationWire[]) => void,
): ArtifactLiveEvent | null {
  // Keep the artifact id beside the frame: this component can be reused by
  // Next navigation, and a high version from the previous id must never win.
  const [live, setLive] = useState<{ id: string; frame: ArtifactLiveEvent } | null>(null);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onAnnotationsRef = useRef(onAnnotations);
  onAnnotationsRef.current = onAnnotations;

  const isOwnFrameRef = useRef(isOwnFrame);
  isOwnFrameRef.current = isOwnFrame;

  /** Highest version this connection has SEEN — including frames it dropped. */
  const seenVersionRef = useRef(initialVersion);

  useEffect(() => {
    if (!enabled) return;
    seenVersionRef.current = initialVersion;
    const source = appEventSource(`/a/${id}/events`);
    let alive = true;
    /*
     * The stream carries PINGS; the document is fetched. A ping names the head
     * (`{editId, version, by}`), and the frame — complete, cached per
     * (id, edit_id) on the server — comes from ./events/frame under the same
     * ACL this page already passed. Ordering: a stale frame (an older
     * version arriving after a newer one) is dropped by version.
     */
    source.onmessage = (event) => {
      let ping: ArtifactVersionPing;
      try { ping = JSON.parse(event.data) as ArtifactVersionPing; } catch { return; }
      if (!Number.isInteger(ping.version)) return;
      if (ping.version < Math.max(initialVersion, seenVersionRef.current)) return;
      seenVersionRef.current = ping.version;
      if (isOwnFrameRef.current?.(ping.editId)) return;
      if (ping.version === initialVersion && ping.editId === initialEditId) return;
      void fetch(`/a/${id}/events/frame`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? (r.json() as Promise<ArtifactLiveEvent>) : null))
        .then((frame) => {
          if (!alive || !frame || frame.version < seenVersionRef.current) return;
          setLive({ id, frame: { ...frame, by: frame.by ?? ping.by } });
        })
        .catch(() => { /* a failed fetch is a dropped wakeup; the next ping retries */ });
    };
    source.addEventListener(STORY_DATA_EVENT, (event: MessageEvent) => {
      try {
        const frame = JSON.parse(event.data) as ArtifactDataEvent;
        if (!Array.isArray(frame.datasets) || frame.datasets.length === 0) return;
        onDataRef.current?.(frame);
      } catch { /* a malformed frame is a dropped wakeup, nothing more */ }
    });
    // Annotations are a PING too: the owner's page refetches the list.
    source.addEventListener(STORY_ANNOTATIONS_EVENT, () => {
      if (!onAnnotationsRef.current) return;
      void fetch(`/api/my/artifacts/${id}/annotations?status=open`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? (r.json() as Promise<{ annotations?: AnnotationWire[] }>) : null))
        .then((body) => { if (alive && body && Array.isArray(body.annotations)) onAnnotationsRef.current?.(body.annotations); })
        .catch(() => { /* next ping */ });
    });
    return () => { alive = false; source.close(); };
  }, [id, initialEditId, initialVersion, enabled]);

  return live?.id === id && live.frame.version > initialVersion ? live.frame : null;
}
