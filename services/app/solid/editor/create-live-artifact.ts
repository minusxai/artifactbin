/**
 * Subscribe a mounted page to its
 * artifact's live document (`GET /a/<id>/events`).
 *
 * The server's stream carries a current head ping; the complete document is
 * fetched from /events/frame after a newer ping. The stream reconnects itself
 * (lib/live-stream), and its first frame is the current head, so a dropped
 * connection heals; a failed frame fetch is retried with backoff.
 *
 * The returned accessor reads null until a frame arrives that differs from
 * what the page was server-rendered with, so the first paint is never
 * disturbed.
 *
 * The highest version seen is tracked per CONNECTION rather than per accepted
 * frame: the server builds frames asynchronously, so they can overtake each
 * other, and the floor must keep counting even for frames this primitive
 * decides not to surface. See `isOwnFrame`.
 *
 * `options` is read LIVE (a Solid props object, not a spread copy): the
 * subscription itself only re-opens when `backend`/`id`/`initialEditId`/
 * `initialVersion`/`enabled` change (the `on([...])` dependency list below) — `isOwnFrame`/`onData`/
 * `onAnnotations`/`since` are read fresh inside the subscription's callbacks
 * with no ref-mirroring needed, since a live getter already reads the latest.
 */
import { createEffect, createSignal, on, onCleanup, type Accessor } from 'solid-js';
import type { AnnotationWire } from '@/lib/annotations/store';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import type { ArtifactDataEvent, ArtifactLiveEvent, ArtifactVersionPing } from '@/lib/story/realtime/live';
import { liveBackoffDelay } from '@/lib/http/live-stream';

export interface LiveArtifactOptions {
  /** Where the stream comes from; a backend without `live` is simply never subscribed. */
  backend: ArtifactBackend;
  id: string;
  initialEditId: string;
  initialVersion: number;
  enabled?: boolean;
  /**
   * "This frame is the echo of a write I made" — the editor's own accepted
   * writes come back down the stream carrying the whole document, and it has
   * already applied them locally. A promise means "cannot tell yet" (the write's reply is still on the wire, and
   * its ping overtook it): the ping is held until it settles, so a page never fetches its own write.
   */
  isOwnFrame?: (editId: string) => boolean | PromiseLike<boolean>;
  /** A DATASET under this document changed (a named `data` frame — see app/a/[id]/events). */
  onData?: (event: ArtifactDataEvent) => void;
  /** The ANNOTATIONS on this document changed (owner-credentialed connections only). */
  onAnnotations?: (annotations: AnnotationWire[]) => void;
  /** Where the stream picks up (ServedResults.since), read when the stream opens. */
  since?: string;
}

export function createLiveArtifact(options: LiveArtifactOptions): Accessor<ArtifactLiveEvent | null> {
  // Keep the artifact id beside the frame: this primitive can be reused across
  // navigation, and a high version from the previous id must never win.
  const [live, setLive] = createSignal<{ id: string; frame: ArtifactLiveEvent } | null>(null);

  createEffect(
    on(
      [() => options.backend, () => options.id, () => options.initialEditId, () => options.initialVersion, () => options.enabled ?? true],
      ([backend, id, initialEditId, initialVersion, enabled]) => {
        if (!enabled || backend.unavailable('live')) return;
        /**
         * Highest version this connection has SEEN — including frames it dropped as its own. A
         * version someone else wrote counts as seen only once its frame has been FETCHED: a failed
         * fetch must not mark it seen, or the page sits one version behind until the next write.
         */
        let seenVersion = initialVersion;
        let alive = true;
        let annotationsRequest: AbortController | undefined;
        /** The newest head announced and not yet fetched; a ping arriving mid-fetch replaces it. */
        let wanted: ArtifactVersionPing | null = null;
        let fetching = false;
        let attempt = 0;
        let retry: ReturnType<typeof setTimeout> | undefined;
        /** Answer `isOwnFrame` for this head: at once when the caller knows, once it settles when it does not. */
        const placeOwn = (editId: string, then: (own: boolean) => void) => {
          const own = options.isOwnFrame?.(editId) ?? false;
          if (typeof own === 'boolean') { then(own); return; }
          void Promise.resolve(own).then((mine) => { if (alive) then(mine); }, () => { if (alive) then(false); });
        };
        const surface = (frame: ArtifactLiveEvent, by: string | null | undefined) => {
          seenVersion = frame.version;
          setLive({ id, frame: { ...frame, by: frame.by ?? by ?? null } });
        };
        /*
         * ONE fetch at a time, so frames cannot overtake each other. A failure (unreachable, or a
         * refused answer) is retried with the stream's backoff until it lands or a newer ping
         * supersedes it — never left for "the next ping", which may not come until the next write.
         */
        const fetchWanted = () => {
          if (!alive || fetching || !wanted) return;
          clearTimeout(retry);
          retry = undefined;
          const target = wanted;
          fetching = true;
          void backend
            .liveFrame()
            .then((frame) => {
              fetching = false;
              if (!alive) return;
              // Refused, or a head older than the one announced (a lagging read): not yet seen, retry.
              if (!frame || frame.version < target.version) throw new Error('frame not available yet');
              attempt = 0;
              if (frame.version >= seenVersion) surface(frame, target.by);
              if (wanted === target) wanted = null;
              else fetchWanted();
            })
            .catch(() => {
              fetching = false;
              if (!alive) return;
              retry = setTimeout(fetchWanted, liveBackoffDelay(attempt++));
            });
        };
        /*
         * The stream carries PINGS; the document is fetched. A ping names the
         * head (`{editId, version, by}`), and the frame — complete, cached per
         * (id, edit_id) on the server — comes from ./events/frame under the
         * same ACL this page already passed. Ordering: a stale frame (an older
         * version arriving after a newer one) is dropped by version.
         */
        const unsubscribe = backend.live(
          {
            onPing: (ping) => {
              if (!Number.isInteger(ping.version)) return;
              if (ping.version < seenVersion) return;
              placeOwn(ping.editId, (own) => {
                // Re-checked: a held ping may have been overtaken while its owner was being decided.
                if (ping.version < seenVersion) return;
                if (own) { seenVersion = ping.version; return; }
                if (ping.version === initialVersion && ping.editId === initialEditId) return;
                if (wanted && wanted.version > ping.version) return;
                wanted = ping;
                // A fresh announcement retries now rather than waiting out the backoff.
                if (retry !== undefined) { attempt = 0; clearTimeout(retry); retry = undefined; }
                fetchWanted();
              });
            },
            /*
             * The page came back (visible, online) and the stream looked alive: one out-of-band read
             * of the head. Only a STRICTLY newer version surfaces, so a check that finds nothing new
             * (or this page's own last write) changes nothing.
             */
            onWake: () => {
              if (!alive) return;
              // A frame fetch is waiting out its backoff (it failed while offline): the page is back, try now.
              if (wanted && retry !== undefined) { attempt = 0; clearTimeout(retry); retry = undefined; fetchWanted(); return; }
              if (fetching || wanted) return;
              void backend.liveFrame().then((frame) => {
                if (!alive || !frame || frame.version <= seenVersion || wanted || fetching) return;
                placeOwn(frame.editId, (own) => {
                  if (frame.version <= seenVersion || wanted || fetching) return;
                  if (own) { seenVersion = frame.version; return; }
                  surface(frame, null);
                });
              }).catch(() => { /* the stream's own reconnect covers an unreachable server */ });
            },
            onData: (frame) => {
              if (!Array.isArray(frame.datasets) || frame.datasets.length === 0) return;
              options.onData?.(frame);
            },
            // Annotations are a PING too: the owner's page refetches the list.
            onAnnotations: () => {
              if (!options.onAnnotations) return;
              annotationsRequest?.abort();
              annotationsRequest = new AbortController();
              void backend
                .listAnnotations('open', { signal: annotationsRequest.signal })
                .then((annotations) => { if (alive) options.onAnnotations?.(annotations); })
                .catch(() => { /* next ping */ });
            },
          },
          options.since ? { since: options.since } : undefined,
        );
        onCleanup(() => { alive = false; clearTimeout(retry); annotationsRequest?.abort(); unsubscribe(); });
      },
    ),
  );

  return () => (live()?.id === options.id && live()!.frame.version > options.initialVersion ? live()!.frame : null);
}
