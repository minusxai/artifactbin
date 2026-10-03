/**
 * `@mx/frame-editor` — THE EDITOR'S DOCUMENT HALF for a framed document (lib/story-runtime/frame-bridge/frame).
 *
 * Its own lazy file beside the shared chunks (scripts/build/build-islands `FRAME_EDITOR`), loaded by the page
 * behaviour's door (lib/story-runtime/frame-bridge/door) only when the app page attaches to edit or comment: no
 * reader's closure carries it. The editor itself (ProseMirror, the edit session, the DOM mounter) stays behind
 * the controller's own dynamic imports, which load on `mx:edit-mode` on.
 */
export { startFrameBridge } from '@/lib/story-runtime/frame-bridge/frame';
