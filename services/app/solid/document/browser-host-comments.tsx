/* @jsxImportSource solid-js */
/**
 * THE HOST COMMENTS MODULE: the reader's discussion for a document another shell on the app's origin mounts with
 * /af/host.js (`mountDocument(container, { id, comments: true })`, lib/html-reader/host-shell), which imports this
 * module (built apart by lib/html-runtime/build-portable-chrome.server, pinned beside it) only when the shell asks.
 *
 * It is the app's own document discussion, not a copy: ./ReaderDiscussion (the frame's selection actions and the
 * comments layer) over the document's live stream (../editor/create-live-artifact) and, when asked, the reader's
 * presence (./create-reader-presence), drawn in trusted shadow roots carrying the app's sheet
 * (lib/ui-runtime/trusted-overlay-host): the marks, composer and popovers in the top layer over the shell, the rail
 * either there too or inside an element the shell gives (`open(panel)`). On a phone the rail is a bottom sheet.
 *
 * Access: nothing here decides anything the doors do not decide again. The reader's role, sign-in and the served open
 * count come from the app page's own admission door (`GET /api/page/artifact/<id>`), the comments and their writes,
 * mentions, presence and the stream from the same doors the app's document page calls, as this origin's session.
 *
 * Look: the shell's theme tokens (the documented contract, `/af/manifest.json` `theme`) when it sets them on its page
 * (`--background` and the rest): they are read at each root's host and mapped onto the app's own tokens; without them
 * the app's own look. Light or dark is the shell's `setMode`, else the page's `data-theme`.
 *
 * Events on the shell's container: `af-document-comments` {open, unread, panel} (unread: open threads that changed on
 * the stream while the rail was closed, since this mount: a count this module keeps, not a server one),
 * `af-document-thread` {id}, `af-document-presence` {viewers, total}, `af-document-sign-in` (cancelable: a signed-out
 * reader asked to comment; the default goes to the sign-in page).
 */
import { createEffect, createSignal, on, onCleanup, untrack } from 'solid-js';
import { render } from 'solid-js/web';
import type { ArtifactRole } from '@artifactbin/contracts';
import type { AnnotationWire } from '@/lib/annotations';
import { createReaderHttpBackend } from '@/lib/artifact-backend/reader-http';
import { loginHref } from '@/lib/http/login-href';
import type { DocumentRuntimeRef } from '@/lib/html-reader/document-endpoint';
import type { HostComments, HostCommentsOptions, HostMode } from '@/lib/html-reader/host-comments-contract';
import { createTrustedOverlayHost } from '@/lib/ui-runtime/trusted-overlay-host';
import { configureTrustedUiStyles } from '@/lib/ui-runtime/trusted-ui-styles';
import { createLiveArtifact } from '../editor/create-live-artifact';
import { createReaderPresence } from './create-reader-presence';
import { HOST_THEME_ATTR, HOST_THEME_CSS, hostSetsTheme } from './host-theme';
import { ReaderDiscussion } from './ReaderDiscussion';

/** What the admission door answers that the discussion reads (lib/document-serving/artifact-page). */
interface PageAnswer { role?: ArtifactRole; kind?: string; archived?: unknown; surface?: { openAnnotations?: number; version?: number; editId?: string } }

type TrustedRoot = ReturnType<typeof createTrustedOverlayHost>;

export function mountHostComments(options: HostCommentsOptions): HostComments {
  const { win, id, bridge } = options;
  const doc = win.document;
  configureTrustedUiStyles(options.stylesheet);
  let mode: HostMode | null = options.mode;
  const roots = new Set<TrustedRoot>();
  /** Each root gets the token bridge beside the app's sheet, its light or dark, and the shell's tokens when it sets them. */
  const dress = (root: TrustedRoot, themed: HTMLElement) => {
    const style = doc.createElement('style');
    style.textContent = HOST_THEME_CSS;
    root.host.shadowRoot!.append(style);
    const inner = root.content.parentElement!;
    if (hostSetsTheme(win, themed)) inner.setAttribute(HOST_THEME_ATTR, '');
    if (mode) root.setTheme(mode);
    roots.add(root);
    return root;
  };
  // Marks, the composer and every popover: the top layer over the shell (the "navigation" root popovers find).
  const overlay = dress(createTrustedOverlayHost({ doc, layer: 'navigation', overlay: true }), doc.documentElement);
  const [railOpen, setRailOpen] = createSignal(false);
  const [panel, setPanel] = createSignal<TrustedRoot | null>(null);
  const [nonce, setNonce] = createSignal(options.nonce() || null);
  const stopNonce = options.onNonce((next) => setNonce(next || null));
  const runtimeRef: DocumentRuntimeRef = { current: bridge };

  const unmount = render(() => {
    const backend = createReaderHttpBackend(id);
    const [page, setPage] = createSignal<PageAnswer | null>(null);
    const abort = new AbortController();
    void win.fetch(`/api/page/artifact/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', signal: abort.signal })
      .then((response) => response.ok ? response.json() as Promise<PageAnswer> : null).then(setPage).catch(() => {});
    onCleanup(() => abort.abort());
    const [head, setHead] = createSignal({ version: options.version, editId: options.editId });
    const [listed, setListed] = createSignal<AnnotationWire[] | null>(null);
    const [live, setLive] = createSignal<AnnotationWire[] | null>(null);
    const [membershipRevision, setMembershipRevision] = createSignal(0);
    const ready = () => !!page() && !!nonce();
    const presence = options.presence
      ? createReaderPresence({ id, revision: () => String(head().version || 1), runtimeRef, nonce, backend, enabled: ready })
      : null;
    createLiveArtifact({
      backend, id, initialEditId: options.editId, initialVersion: options.version,
      get enabled() { return !!page() && typeof EventSource === 'function'; },
      // The frame draws a new version itself (the host module's followVersion); this page keeps the head comments are made on.
      onPublication: (version, editId, _title, liveRevision) => {
        if (editId && version >= untrack(head).version) setHead({ version, editId });
        options.followVersion(version, liveRevision ?? 0);
      },
      onData: (event) => {
        if (event.datasets.includes('_members')) setMembershipRevision((n) => n + 1);
        options.notifyData(event.datasets);
      },
      onAnnotations: setLive,
      ...(presence ? { onPresence: presence.receive } : {}),
    });
    const openRows = () => (listed() ?? live())?.filter((row) => row.status === 'open') ?? null;
    const openCount = () => openRows()?.length ?? page()?.surface?.openAnnotations ?? 0;
    // Unread: an open thread whose newest comment, by someone else, arrived while the rail was closed (since this mount).
    const [me, setMe] = createSignal<string | null>(null);
    void win.fetch('/api/page/session', { credentials: 'same-origin', cache: 'no-store', signal: abort.signal })
      .then((response) => response.ok ? response.json() as Promise<{ user?: { id?: string } | null }> : null).then((session) => setMe(session?.user?.id ?? null)).catch(() => {});
    const seen = new Map<string, string>();
    let primed = false;
    const [unread, setUnread] = createSignal<ReadonlySet<string>>(new Set());
    createEffect(on([() => listed() ?? live(), railOpen], ([rows, open]) => {
      if (!rows) return;
      const next = new Set<string>();
      for (const row of rows) {
        if (row.status !== 'open') continue;
        const newest = row.thread.at(-1);
        const signature = newest?.id ?? row.id;
        if (!primed || open || newest?.author?.user_id === untrack(me)) seen.set(row.id, signature);
        else if (seen.get(row.id) !== signature) next.add(row.id);
      }
      primed = true;
      setUnread(next);
    }));
    createEffect(() => options.emit('af-document-comments', { open: openCount(), unread: unread().size, panel: railOpen() }));
    if (presence) createEffect(() => options.emit('af-document-presence', { viewers: presence.viewers().map(({ id: viewer, label, colorId }) => ({ id: viewer, label, colorId })), total: presence.total() }));
    const signIn = () => { if (options.emit('af-document-sign-in', {}, true)) win.location.assign(loginHref(win.location, 'comment')); };
    const linked = () => { const query = new URLSearchParams(win.location.search); return !!(query.get('comment') || query.get('thread')); };
    return <>{page() && <ReaderDiscussion id={id} role={page()!.role ?? 'viewer'} accountSession={page()!.kind === 'account'} archived={!!page()!.archived}
      runtimeRef={runtimeRef} ready={ready()} nonce={nonce()} editId={head().editId} canDeleteAny={page()!.role === 'owner'}
      railOpen={railOpen()} onRailOpenChange={(open) => { if (open) setRailOpen(true); else hostComments.close(); }} liveAnnotations={live()} openCount={openCount()} linked={linked()}
      onAnnotationsChange={setListed} onOpenThreadChange={(thread) => options.emit('af-document-thread', { id: thread })} onSignIn={signIn}
      membershipRevision={membershipRevision()} topOffset={Math.max(0, Math.round(bridge.getViewportRect().top))}
      railHost={panel()?.content} />}</>;
  }, overlay.content);

  const dropPanel = () => { const root = panel(); if (!root) return; roots.delete(root); root.dispose(); setPanel(null); };
  const hostComments: HostComments = {
    open(target) {
      if (!target) dropPanel();
      else if (panel()?.host.parentElement !== target) { dropPanel(); setPanel(dress(createTrustedOverlayHost({ doc, parent: target }), target)); }
      setRailOpen(true);
    },
    close() { setRailOpen(false); dropPanel(); },
    setMode(next) {
      mode = next;
      for (const root of roots) {
        root.setTheme(next);
        // A shell may set (or change) its tokens with its mode.
        const inner = root.content.parentElement!;
        inner.toggleAttribute(HOST_THEME_ATTR, hostSetsTheme(win, root.host.parentElement ?? doc.documentElement));
      }
    },
    destroy() { stopNonce(); unmount(); dropPanel(); overlay.dispose(); roots.clear(); },
  };
  return hostComments;
}
