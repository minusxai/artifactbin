/**
 * THE DOCUMENT HOST MODULE (`/af/host.js`, pinned in /af/manifest.json): the trusted parent's half of the page bridge
 * for another shell SERVED AT THE APP'S OWN ORIGIN (a front door that passes the app's API through), with no app code.
 * The same pieces the app's document page runs (solid/document/create-framed-story, solid/pages/Document):
 * frame-bridge/parent, ./frame-session, ./frame-navigation, ./follow-version, and the frame's exact sandbox.
 *
 *   import { mountDocument } from '/af/host.js';
 *   const doc = await mountDocument(container, { id: 'AbC123' });
 *   container.addEventListener('af-document-selection', (event) => console.log(event.detail));
 *   doc.setMode('dark');
 *
 * What a host gets: the document in its frame as the signed-in reader (the frame's ticket comes from
 * /api/page/frame/<id> with this origin's session), its `sql` and `fetch('/fn/NAME')` relayed exactly as on the app
 * page (path, revision and read-only pinning: frame-bridge/parent), reader mode and design system, selecting or
 * revealing a node, the address's hash, a top inset, following a new version, dataset wakeups, the frame's events
 * and link navigations, and the raw bridge (`bridge`) for the rest.
 *
 * WITH `comments: true`, the reader's discussion as the app's own document page has it: the frame is granted its
 * selection actions (the toolbar and context menu: Comment, Select) as the reader's role allows, and the comments
 * (pins on the page, the composer, the rail with its threads, replies, resolving, saved views, mentions, live updates)
 * are drawn by the app's own discussion UI. It is a module of its own (solid/document/browser-host-comments, pinned
 * beside this one, the address baked in at build) imported only then: a shell that never asks loads none of it. Its
 * stream also follows new versions and dataset changes (`followVersion` / `notifyData`), and with `presence: true`
 * publishes this reader's presence and reports the others. `openComments(panel?)` / `closeComments()` show the rail.
 * Not included: uploads (refused, no upload session), region and cell editing.
 *
 * Public code: it carries no credential and adds none (requests are this origin's own, `same-origin`). A document
 * trusts exactly one parent origin, baked in when it is served; the module refuses to mount anywhere else, and the
 * document's door (lib/html-runtime/frame-door) drops every message from another origin regardless.
 */
import { createFrameBridgeParent, urlValuesOf, type FrameBridgeParent } from './frame-bridge/parent';
import { STORY_FRAME_HASH_MESSAGE, STORY_READER_MODE_MESSAGE, STORY_URL_VALUES_MESSAGE } from './contract';
import { FRAME_ALLOW, FRAME_SANDBOX } from './frame-markup';
import { keepFrameSession } from './frame-session';
import { answerFrameNavigation } from './frame-navigation';
import { followHtmlVersion } from './follow-version';
import type { HostComments, HostCommentsModule, HostMode } from './host-comments-contract';

/** The host comments module's pinned address, defined by the build (lib/html-runtime/build.server); the flat one unbuilt. */
declare const __AF_HOST_COMMENTS__: string | undefined;
const HOST_COMMENTS_PATH = typeof __AF_HOST_COMMENTS__ === 'string' ? __AF_HOST_COMMENTS__ : '/af/host-comments.js';

export interface MountDocumentOptions {
  /** The document's id (`/a/<id>`). */
  id: string;
  /** The frame's accessible name. */
  title?: string;
  /** Query carried into the frame's first URL (the document's `$` values, `mx-mode`), as the app page's own. */
  search?: string;
  /** The reader's discussion: selection actions and comments (loads the host comments module). */
  comments?: boolean;
  /** With `comments`: publish this reader's presence and report the others (`af-document-presence`). */
  presence?: boolean;
}

/** For tests: how the comments module is loaded (default: its pinned address, same-origin). */
export interface MountDocumentHooks { loadComments?: () => Promise<HostCommentsModule> }

type Mode = 'light' | 'dark';
export interface MountedDocument {
  readonly frame: HTMLIFrameElement;
  /** The document's origin and the revision relays are pinned to (moves with `followVersion`). */
  readonly origin: string;
  readonly revision: string;
  /** The raw parent half of the bridge (send, subscribe, sendRegion, subscribeRegion, …), for what this module leaves out. */
  readonly bridge: FrameBridgeParent;
  setMode(mode: Mode): void;
  setDesignSystem(name: string, mode: Mode): void;
  /** Select the node `[data-af-id=path]` (null clears); `reveal` scrolls it into view. Answered by `af-document-selection`. */
  select(path: string | null, options?: { reveal?: boolean }): void;
  scrollToHash(hash: string): void;
  /** The `$` values this host's address holds after its own Back or Forward: the page's route follows them. */
  setUrlValues(search: string): void;
  /** How far the host's bars reach over the frame's top edge: the document reserves it. */
  setInset(px: number): void;
  /** A newer published version: drawn in place or rebuilt by the frame; otherwise the frame is loaded afresh. */
  followVersion(version: number, live?: number): Promise<'morphed' | 'rebuilt' | 'reloaded'>;
  /** Datasets the document reads changed: it re-runs its queries. */
  notifyData(datasets: string[]): void;
  /** With `comments`: open the comments rail inside `panel` (an element the shell lays out), or over the page's right edge. */
  openComments(panel?: HTMLElement | null): void;
  closeComments(): void;
  destroy(): void;
}

/** The frame endpoint's answer (lib/document-serving/artifact-page FreshFrame). */
interface FreshFrame { src: string; origin: string; appOrigin: string; revision: string; editId: string }

export class HostShellError extends Error {
  constructor(readonly code: 'not_found' | 'wrong_origin' | 'unavailable', message: string) { super(message); this.name = 'HostShellError'; }
}

async function freshFrame(win: Window, id: string, search: string): Promise<FreshFrame> {
  let response: Response;
  try {
    response = await win.fetch(`/api/page/frame/${encodeURIComponent(id)}${search}`, { credentials: 'same-origin', cache: 'no-store' });
  } catch { throw new HostShellError('unavailable', 'The document frame could not be requested.'); }
  // A document this reader may not read is the same uniform 404 the app page gets.
  if (response.status === 404) throw new HostShellError('not_found', `Document ${id} was not found, or this reader may not read it.`);
  const answer = await response.json().catch(() => null) as Partial<FreshFrame> | null;
  if (!response.ok || !answer || typeof answer.src !== 'string' || typeof answer.origin !== 'string' || typeof answer.appOrigin !== 'string' || typeof answer.revision !== 'string')
    throw new HostShellError('unavailable', 'The document frame could not be requested.');
  return { src: answer.src, origin: answer.origin, appOrigin: answer.appOrigin, revision: answer.revision, editId: typeof answer.editId === 'string' ? answer.editId : '' };
}

/** Mount document `id` into `container`. Rejects with a HostShellError when it cannot. */
export async function mountDocument(container: HTMLElement, options: MountDocumentOptions, win: Window = window, hooks: MountDocumentHooks = {}): Promise<MountedDocument> {
  const search = options.search ?? '';
  // Asked for, the comments module loads beside the frame's ticket, never after it.
  const commentsModule = options.comments
    ? (hooks.loadComments ?? (() => import(/* @vite-ignore */ new URL(HOST_COMMENTS_PATH, win.location.href).href) as Promise<HostCommentsModule>))()
    : null;
  commentsModule?.catch(() => {});
  const first = await freshFrame(win, options.id, search);
  if (first.appOrigin !== win.location.origin) throw new HostShellError('wrong_origin', `This document trusts only ${first.appOrigin} as its parent; a host page must be served there, not at ${win.location.origin}.`);
  const { origin, id } = { origin: first.origin, id: options.id };
  let revision = first.revision;
  const doc = container.ownerDocument;
  const emit = (name: string, detail: unknown, cancelable = false) => container.dispatchEvent(new (win as unknown as typeof globalThis).CustomEvent(name, { detail, cancelable }));
  const nonceListeners = new Set<(nonce: string) => void>();

  const frame = doc.createElement('iframe');
  frame.setAttribute('sandbox', FRAME_SANDBOX);
  frame.setAttribute('allow', FRAME_ALLOW);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = options.title ?? 'Document';
  frame.src = first.src;
  container.append(frame);

  const bridge = createFrameBridgeParent({
    win, frame, frameOrigin: origin, id,
    editId: () => first.editId, source: () => null,
    // No upload session: the bridge refuses uploads before any request.
    htmlContext: () => ({ revision, readOnly: false }),
    onReady: (nonce) => { if (nonce) emit('af-document-ready', { nonce }); for (const listener of [...nonceListeners]) listener(nonce); },
    onScroll: (scroll) => emit('af-document-scroll', scroll),
    onClosed: (reason) => emit('af-document-closed', { reason }),
    onUrlValues: (search, push) => emit('af-document-url-values', { search, push }),
  });
  const stopEvents = bridge.subscribe((event) => {
    emit('af-document-event', event);
    const data = event as { type?: unknown; nonce?: unknown; selection?: unknown } | null;
    if (data?.type === 'mx:selection' && data.nonce === bridge.nonce) emit('af-document-selection', data.selection ?? null);
  });
  const remint = async (documentId: string) => { try { return (await freshFrame(win, documentId, search)).src; } catch { return null; } };
  const stopSession = keepFrameSession({ win, frame, origin, id, remint });
  // A link to an app path: the host may take it (preventDefault on the event), else the tab follows it.
  const stopNavigation = answerFrameNavigation({
    win, frame, frameOrigin: origin,
    navigate: (path) => { if (emit('af-document-navigate', { path }, true)) win.location.assign(path); },
  });
  const reload = () => { void remint(id).then((src) => { if (src) frame.src = src; }); };
  const followVersion = (version: number, live = 0) => followHtmlVersion({
    version, live, frame: bridge, reload,
    refresh: async (drawn, shown) => {
      const next = Number(shown);
      if (!Number.isInteger(next) || next < drawn) return false;
      revision = String(next);
      return true;
    },
  });
  // The discussion, once its module arrives; what the shell asked of it before then is kept and handed over.
  let mode: HostMode | null = null;
  let comments: HostComments | null = null;
  let wanted: { open: boolean; panel: HTMLElement | null } = { open: false, panel: null };
  let destroyed = false;
  void commentsModule?.then(({ mountHostComments, stylesheet }) => {
    if (destroyed) return;
    comments = mountHostComments({
      win, id, stylesheet, emit, bridge, frame, mode, presence: options.presence === true,
      nonce: () => bridge.nonce, onNonce: (listener) => { nonceListeners.add(listener); return () => { nonceListeners.delete(listener); }; },
      version: Number(first.revision) || 0, editId: first.editId,
      followVersion: (version, live) => { void followVersion(version, live); },
      notifyData: (datasets) => bridge.invalidate(datasets),
    });
    if (wanted.open) comments.open(wanted.panel);
  }, () => emit('af-document-comments-unavailable', {}));

  return {
    frame, origin, bridge,
    get revision() { return revision; },
    setMode(next) { mode = next; bridge.send({ type: STORY_READER_MODE_MESSAGE, mode: next }); comments?.setMode(next); },
    setDesignSystem: (name, mode) => bridge.send({ type: 'mx:design-system', name, mode }),
    select: (path, selectOptions) => bridge.send({ type: 'mx:select', path, ...(selectOptions?.reveal ? { reveal: true } : {}) }),
    scrollToHash(hash) {
      if (!/^#\S{1,512}$/.test(hash)) return;
      try { frame.contentWindow?.postMessage({ type: STORY_FRAME_HASH_MESSAGE, hash }, origin); } catch { /* the frame went away */ }
    },
    setUrlValues(search) {
      if (urlValuesOf({ type: STORY_URL_VALUES_MESSAGE, search }) === null) return;
      try { frame.contentWindow?.postMessage({ type: STORY_URL_VALUES_MESSAGE, search }, origin); } catch { /* the frame went away */ }
    },
    setInset: (px) => bridge.setTopInset(px),
    followVersion,
    notifyData: (datasets) => bridge.invalidate(datasets),
    openComments(panel) { wanted = { open: true, panel: panel ?? null }; comments?.open(panel ?? null); },
    closeComments() { wanted = { open: false, panel: null }; comments?.close(); },
    destroy() { destroyed = true; comments?.destroy(); nonceListeners.clear(); stopEvents(); stopNavigation(); stopSession(); bridge.dispose(); frame.remove(); },
  };
}
