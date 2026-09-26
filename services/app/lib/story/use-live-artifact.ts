'use client';

/**
 * Subscribe a mounted page to its artifact's live document
 * (`GET /a/<id>/events`).
 *
 * The server's stream carries a current head ping; the complete document is
 * fetched from /events/frame after a newer ping. EventSource reconnects and
 * the ping plus frame fetch self-heal a dropped connection.
 *
 * The hook returns null until a frame arrives that differs from what the page
 * was server-rendered with, so the first paint is never disturbed.
 *
 * The highest version seen is tracked per CONNECTION rather than per accepted
 * frame: the server builds frames asynchronously, so they can overtake each
 * other, and the floor must keep counting even for frames this hook decides not
 * to surface. See `isOwnFrame`.
 */
import { useEffect, useRef, useState } from 'react';
import type { AnnotationWire } from '@/lib/annotations';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import type { ArtifactDataEvent, ArtifactLiveEvent } from '@/lib/story/live';

export function useLiveArtifact(
  /** Where the stream comes from; a backend without `live` is simply never subscribed. */
  backend: ArtifactBackend,
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
   * forwards it into the mounted runtime, which re-runs the affected queries in place.
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
  // SPA navigation, and a high version from the previous id must never win.
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
    if (!enabled || backend.unavailable('live')) return;
    seenVersionRef.current = initialVersion;
    let alive = true;let annotationsRequest:AbortController|undefined;
    /*
     * The stream carries PINGS; the document is fetched. A ping names the head
     * (`{editId, version, by}`), and the frame — complete, cached per
     * (id, edit_id) on the server — comes from ./events/frame under the same
     * ACL this page already passed. Ordering: a stale frame (an older
     * version arriving after a newer one) is dropped by version.
     */
    const unsubscribe = backend.live({
      onPing: (ping) => {
        if (!Number.isInteger(ping.version)) return;
        if (ping.version < Math.max(initialVersion, seenVersionRef.current)) return;
        seenVersionRef.current = ping.version;
        if (isOwnFrameRef.current?.(ping.editId)) return;
        if (ping.version === initialVersion && ping.editId === initialEditId) return;
        void backend.liveFrame()
          .then((frame) => {
            if (!alive || !frame || frame.version < seenVersionRef.current) return;
            setLive({ id, frame: { ...frame, by: frame.by ?? ping.by } });
          })
          .catch(() => { /* a failed fetch is a dropped wakeup; the next ping retries */ });
      },
      onData: (frame) => {
        if (!Array.isArray(frame.datasets) || frame.datasets.length === 0) return;
        onDataRef.current?.(frame);
      },
      // Annotations are a PING too: the owner's page refetches the list.
      onAnnotations: () => {
        if (!onAnnotationsRef.current) return;
        annotationsRequest?.abort();annotationsRequest=new AbortController();
        void backend.listAnnotations('open',{signal:annotationsRequest.signal})
          .then((annotations) => { if (alive) onAnnotationsRef.current?.(annotations); })
          .catch(() => { /* next ping */ });
      },
    });
    return () => { alive = false; annotationsRequest?.abort();unsubscribe(); };
  }, [backend, id, initialEditId, initialVersion, enabled]);

  return live?.id === id && live.frame.version > initialVersion ? live.frame : null;
}
