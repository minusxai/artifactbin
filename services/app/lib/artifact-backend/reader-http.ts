/** The initial reader's transport. Authoring/comment modules compose this port when opened. */
import {PRESENCE_EVENT,type PresencePublication,type PresenceViewer} from '@/lib/html-presence/contract';
import {STORY_ANNOTATIONS_EVENT,STORY_DATA_EVENT,type ArtifactDataEvent,type ArtifactLiveEvent,type ArtifactVersionPing} from '@/lib/story-runtime/contract';
import {openLiveStream} from '@/lib/http/live-stream';
import {readAnnotationPages} from '@/lib/annotations/pages';
import type {ArtifactHead,ReaderArtifactBackend} from './types';
const JSON_HEADERS={'Content-Type':'application/json'};
export function createReaderHttpBackend(id:string):ReaderArtifactBackend {
 const mine=`/api/my/artifacts/${id}`;
 return {
    unavailable:()=>null,
    listAnnotations(status, options = {}) {
      return readAnnotationPages(`${mine}/annotations${status ? `?status=${status}` : ''}`, options);
    },

    async load() {
      const res = await fetch(mine);
      return res.ok ? ((await res.json()) as ArtifactHead) : null;
    },
    async publishPresence(input: PresencePublication) {
      const response=await fetch(`/api/artifacts/${encodeURIComponent(id)}/presence`,{method:'POST',credentials:'same-origin',headers:JSON_HEADERS,body:JSON.stringify(input),keepalive:!input.visible});
      if(!response.ok)return null;const body=await response.json() as {id?:unknown};return typeof body.id==='string'?body.id:null;
    },
    live(handlers, options) {
      // Reconnecting, with a heartbeat watchdog and a catch-up on wake (lib/live-stream).
      const stream = openLiveStream({
        url: `/a/${id}/events${options?.since ? `?since=${encodeURIComponent(options.since)}` : ''}`,
        onMessage: (data) => {
          let ping: ArtifactVersionPing;
          try { ping = JSON.parse(data) as ArtifactVersionPing; } catch { return; }
          handlers.onPing(ping);
        },
        events: {
          [PRESENCE_EVENT]: data => {try {const viewers:unknown=JSON.parse(data);if(Array.isArray(viewers))handlers.onPresence?.(viewers as PresenceViewer[]);}catch{}},
          [STORY_DATA_EVENT]: (data) => {
            try { handlers.onData(JSON.parse(data) as ArtifactDataEvent); } catch { /* a malformed frame is a dropped wakeup, nothing more */ }
          },
          [STORY_ANNOTATIONS_EVENT]: () => handlers.onAnnotations(),
        },
        onWake: handlers.onWake,
      });
      return () => stream.close();
    },
    async liveFrame() {
      const r = await fetch(`/a/${id}/events/frame`, { credentials: 'same-origin' });
      return r.ok ? ((await r.json()) as ArtifactLiveEvent) : null;
    },
 };
}
