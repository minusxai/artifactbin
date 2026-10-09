/**
 * THE FRAME'S DOOR — the one listener a framed document's bridge traffic ever reaches.
 *
 * Installed by the page behaviour (lib/islands/page, `@mx/page`) in a framed document, which runs BEFORE the
 * author's script exists (the assembler writes behaviour scripts ahead of the per-document module). So this
 * listener is registered first, in the capture phase, with the primitives it needs captured now:
 *
 *  · every bridge envelope (lib/story-runtime/contract STORY_FRAME_BRIDGE_MESSAGE) is stopped here, accepted or
 *    not, so no later listener — the author's included — sees one. The page's `key` therefore never enters the
 *    author's reach, and a reply forged by the author's script carries no key the page will accept;
 *  · an envelope counts only when it is trusted, came from THIS window's parent, and from the app's origin;
 *  · the first `attach` loads the editor's document half (`@mx/frame-editor`, lib/islands/frame-editor) and hands
 *    it this door's `post`; everything else for that key is queued until it runs, then passed to it.
 *
 * Framework-free, value-free imports only: it is part of every framed reader's `@mx/page` chunk.
 */
import type { FrameBridgeAttach, FrameBridgeFramePayload, FrameBridgeParentPayload } from '@/lib/story-runtime/contract';
export { APP_ORIGIN_ATTR, frameAppOrigin } from './origin';

/** lib/story-runtime/contract STORY_FRAME_BRIDGE_MESSAGE, restated so the reader chunk carries no contract value (door.test pins them equal). */
export const FRAME_BRIDGE_MESSAGE = 'mx:frame-bridge';

export interface FrameBridgeSession {
  receive(payload: FrameBridgeParentPayload): void;
  dispose(): void;
}
export interface FrameBridgeStartOptions {
  win: Window;
  /** Post to the page that framed this document, with the session's key. */
  post: (payload: FrameBridgeFramePayload) => void;
  attach: FrameBridgeAttach;
}
export type FrameBridgeStart = (options: FrameBridgeStartOptions) => FrameBridgeSession;

const MIN_KEY = 16;

/**
 * Open the door. `load` resolves the editor's document half; it is called on the first trusted `attach` only.
 * Returns the disposer (tests, unmount).
 */
export function openFrameDoor(win: Window, appOrigin: string, load: () => Promise<{ startFrameBridge: FrameBridgeStart }>): () => void {
  // Captured now, before the author's script can replace them.
  const parent = win.parent;
  const reflectApply = Reflect.apply;
  const proto = (win as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent.prototype;
  const getter = (name: 'data' | 'origin' | 'source') => Object.getOwnPropertyDescriptor(proto, name)!.get!;
  const dataOf = getter('data'), originOf = getter('origin'), sourceOf = getter('source');
  const stop = (win as unknown as { Event: typeof Event }).Event.prototype.stopImmediatePropagation;
  const postMessage = parent.postMessage;
  const send = (envelope: unknown) => { try { reflectApply(postMessage, parent, [envelope, appOrigin]); } catch { /* the page went away */ } };

  let session: { key: string; started: FrameBridgeSession | null; queue: FrameBridgeParentPayload[] } | null = null;
  const end = () => { const ending = session; session = null; ending?.started?.dispose(); };

  const onMessage = (event: MessageEvent) => {
    const data = reflectApply(dataOf, event, []) as { type?: unknown; key?: unknown; payload?: unknown } | null;
    if (!data || typeof data !== 'object' || data.type !== FRAME_BRIDGE_MESSAGE) return;
    reflectApply(stop, event, []);
    if (!event.isTrusted || reflectApply(sourceOf, event, []) !== parent || reflectApply(originOf, event, []) !== appOrigin) return;
    const { key, payload } = data as { key: unknown; payload: FrameBridgeParentPayload | null };
    if (typeof key !== 'string' || key.length < MIN_KEY || !payload || typeof payload !== 'object') return;
    if (payload.kind === 'attach') {
      if (session?.key === key) return;
      end();
      const current = { key, started: null as FrameBridgeSession | null, queue: [] as FrameBridgeParentPayload[] };
      session = current;
      const post = (out: FrameBridgeFramePayload) => { if (session === current) send({ type: FRAME_BRIDGE_MESSAGE, key, payload: out }); };
      void load().then(({ startFrameBridge }) => {
        if (session !== current) return;
        current.started = startFrameBridge({ win, post, attach: payload });
        for (const queued of current.queue.splice(0)) current.started.receive(queued);
      }).catch((error: unknown) => post({ kind: 'error', message: `the editor could not load: ${String(error)}` }));
      return;
    }
    if (!session || session.key !== key) return;
    if (payload.kind === 'detach') { end(); return; }
    if (session.started) session.started.receive(payload);
    else session.queue.push(payload);
  };
  win.addEventListener('message', onMessage, true);
  // The door is open: the page may attach (it may also attach on the frame's load).
  send({ type: FRAME_BRIDGE_MESSAGE, payload: { kind: 'hello' } });
  return () => { win.removeEventListener('message', onMessage, true); end(); };
}
