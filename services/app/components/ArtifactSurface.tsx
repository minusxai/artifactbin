'use client';

import type { Visibility } from '@/lib/artifacts';
import type { DatasetCatalog } from '@/lib/datasets/types';
import { datasetQuerySnippet } from '@/lib/story/dataset-usage';
import { DatasetCatalogView } from '@/components/DatasetCatalogView';

/**
 * The client half of /a/<id>: what the artifact LOOKS like, and whether we
 * are viewing or editing it.
 *
 * Edit is a mode here, not a route — the artifact has exactly one URL. The
 * mode is mirrored in the `#edit` fragment so the dashboard can deep-link to
 * it and so refresh/back behave, while the canonical shared link stays
 * `/a/<id>` (a fragment never reaches the server).
 *
 * The editor is loaded ON DEMAND: it pulls in the WYSIWYG, the AST write-back
 * and Monaco, and a reader of a shared document must never pay for that.
 */
import dynamic from '@/lib/dynamic';
import { FolderPlus, MessageSquare, Pencil } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InlineStoryController } from '@/lib/story-runtime/InlineStoryRuntime';
import { createAuthenticatedTransport } from '@/lib/story-runtime/authenticated-transport';
import { subscribeDocument } from '@/lib/story-runtime/document-endpoint';
import type { PreparedStoryRuntime } from '@/lib/story/prepared-runtime';
import type { ReaderForkedFrom } from '@/lib/story/reader-chrome';
import { storyUpdateParts } from '@/lib/story/update-parts';
import { TrustedUi } from '@/components/TrustedUi';
import { useLocation, useNavigate } from 'react-router';
import { InlineReaderChrome } from '@/components/InlineReaderChrome';
import { useArtifactOwner, useCanAnnotateArtifact, useCanEditArtifact } from '@/components/ArtifactShell';
import AnnotationLayer from '@/components/AnnotationLayer';
import CopyAgentPrompt from '@/components/CopyAgentPrompt';
import RefreshAssets from '@/components/RefreshAssets';
import ForkArtifact, { ForkConfirm } from '@/components/ForkArtifact';
import ShareLink from '@/components/ShareLink';
import type { AnnotationWire } from '@/lib/annotations';
import { readIntent, stripIntent, withIntent } from '@/lib/intent';
import PageChrome, { PageControls, PageMenu, requestPageChrome, type AppearanceMode } from '@/components/PageChrome';
import { useIsPhoneViewport } from '@/components/MobileSheet';
/* The editing bar's height is RESERVED by this page, never measured — and it
 * comes from a leaf module, because importing it from the editor would put the
 * editor in every reader's bundle (lib/__tests__/reader-bundle-hygiene). */
import { APP_BAR_H, EDIT_BAR_H, RIGHT_RAIL_W } from '@/lib/story/edit-bar';
import type { ArtifactFormat } from '@/lib/story/input';
import { useLiveArtifact } from '@/lib/story/use-live-artifact';
import { pageDataChanged } from '@/web/page-data-events';
import { STORY_DATA_MESSAGE, STORY_DOCUMENT_MESSAGE, STORY_READER_MODE_MESSAGE, type StoryDataUpdate, isEditFrameMessage, isValuesMessage, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE, type StoryEditSelection, type StorySelectionActionsMessage } from '@/lib/story-runtime/contract';
import { readUrlValues, writeUrlValues } from '@/lib/story/url-values';
import { displayTitle } from '@/lib/story/title';
import { formatFileSize } from '@/lib/file-display';
import { resolveStoryMode } from '@/lib/data/story/story-themes';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import type { StoryIslandDataflow } from '@/lib/story-runtime/contract';

const InlineStoryRuntime = dynamic(() => import('@/lib/story-runtime/InlineStoryRuntime').then(module => ({default:module.InlineStoryRuntime})), { ssr: false });
const ArtifactEditor = dynamic(() => import('@/components/ArtifactEditor'), {
  ssr: false,
  loading: () => <p className="mt-10 text-center text-xs text-faint">loading the editor…</p>,
});

const SocialPreviewDialog = dynamic(() => import('@/components/SocialPreviewDialog'), {
  ssr: false,
  loading: () => <p className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 font-mono text-xs text-white">loading preview…</p>,
});

export interface ArtifactSurfaceProps {
  runtime?: PreparedStoryRuntime;
  author?: { username: string | null; forkedFrom?: ReaderForkedFrom | null } | null;
  /**
   * The exporter's signed key, when this render IS a capture (server-parsed
   * from `?key=`). Null for every human render.
   */
  captureKey?: string | null;
  id: string;
  /** Head pointer at render time — the baseline the live stream is compared against. */
  editId: string;
  format: ArtifactFormat;
  visibility?: Visibility;
  title: string | null;
  /** pdf: how big the file is and how long, as the file view says it. */
  bytes?: number;
  pages?: number | null;
  source: string | null;
  /** meta scalars the editor needs, so entering edit mode costs no round trip. */
  template: string | null;
  refs: Array<{ id: string; kind: string }>;
  /** The document's server-run dataflow (lib/artifacts dataflowForRow) — seeds the editor's canvas. */
  dataflow?: StoryIslandDataflow | null;
  /**
   * The page's own query string, from the router (never `window.location` in
   * render — that is a hydration mismatch waiting to happen). Its `$` params
   * are the reader's `<Value>` selection and are forwarded into the mounted
   * document runtime; everything else in it is the page's business, not the
   * document's, and is deliberately left behind.
   */
  search?: string;
  /** An ACCOUNT session (account authentication) holds this browser — the bar offers Sign out. */
  accountSession?: boolean;
  /** An ANONYMOUS session (agent cookie, no account) — the bar offers Disconnect. */
  anonSession?: boolean;
  version: number;
  /** Open-annotation count at render time (viewers who may annotate) — seeds the annotate button's badge; live updates keep it current. */
  openAnnotations?: number;
  /**
   * The viewer's like state and the document's like count, from the page's own
   * fetch. Optional because every other render of this surface (the export
   * capture, the ui suite's fixtures) has nobody to ask.
   */
  like?: { liked: boolean; count: number };
  /** Who to follow and whether we do — null for an anonymous document, or the owner's own. */
  follow?: { userId: string; following: boolean; count: number } | null;
  content: string;
  columns: Array<{ name: string; type?: string }>;
  catalog?: DatasetCatalog;
  compiledCss: string | null;
  theme: StoryThemeName | null;
  colorMode: 'light' | 'dark' | null;
}

/**
 * NAMING A FOLDER MADE INSIDE ANOTHER — the shell's half of `New folder`.
 *
 * Inline and nothing else: Enter creates, Escape discards, and NOTHING
 * navigates. The row it makes arrives in the listing on its own, because a
 * folder's source names its own id as a table and a write to a child NOTIFYs
 * that channel (lib/folders notifyParent) — the same live path an agent's
 * publish already travels. So this closes and says nothing more.
 */
function NewFolderPrompt({ parentId, onClose }: { parentId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    const res = await fetch('/api/my/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'folder', title, parent_id: parentId }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onClose();
  };
  return (
    <div className="fixed inset-x-0 top-16 z-50 flex justify-center px-4">
      <div className="flex items-center gap-2 rounded-[6px] border border-edge bg-surface px-2 py-1.5 shadow-lg">
        <FolderPlus size={13} className="shrink-0 text-faint" />
        <input
          aria-label="Folder name"
          placeholder="folder name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void create(); }
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
          className="w-44 rounded-[4px] border border-edge bg-transparent px-1.5 py-0.5 font-mono text-xs text-fg focus:border-edge-bright focus:outline-none"
        />
        <span className="font-mono text-[10px] text-faint">enter</span>
      </div>
    </div>
  );
}



/**
 * Neutral fallback ground while the mounted runtime applies the document's
 * compiled and author styles. It is selected by reading mode so a slow runtime
 * does not reveal a contrasting blank surface.
 */
const DOCUMENT_GROUND = { light: '#ffffff', dark: '#0b0b0c' } as const;

const CONTROL_ROW = 'flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs text-muted transition-colors hover:bg-raised hover:text-fg';


const safeRows = (content: string): Array<Record<string, unknown>> => {
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * The view-mode selection bubble exposes only actions this role may take. ONE
 * rule, consulted twice: once to grant the bubble, and again before acting on
 * what it sends back — the mounted runtime and any author child realm are
 * never an authority.
 *
 * `inViewMode` is now only about EDIT MODE, because annotate is not a mode any
 * more. It still gates BOTH actions: inside the editor the document's own
 * selection bubble would fight the caret and the format toolbar, so the
 * editor offers Comment from its toolbar instead. Same capability, different
 * surface — which is the whole shape of this change.
 *
 * `annotate` follows `canAnnotate` rather than ownership: a document two people
 * may write should not be a document only one may discuss, and a COMMENTER is
 * someone invited to discuss it and nothing else. The API agrees
 * (lib/annotations' annotationScope, which is owner|editor|commenter) — a
 * capability the door refuses is a dead button, and one the door admits but
 * the page withholds is a role that does not exist.
 */
const selectionActionCapabilities = (canEdit: boolean, canAnnotate: boolean, inViewMode: boolean) => ({
  edit: inViewMode && canEdit,
  annotate: inViewMode && canAnnotate,
});

export default function ArtifactSurface(props: ArtifactSurfaceProps) {
  const runtimeRef = useRef<InlineStoryController | null>(null);
  const route = useLocation();
  const navigate = useNavigate();
  const [copiedRef, setCopiedRef] = useState(false);
  const { id, editId, format, title, source, content, columns, bytes: fileBytes = 0, pages: filePages = null, compiledCss, theme, colorMode, template, refs, dataflow = null, search = '', accountSession = false, anonSession = false, version, openAnnotations = 0, like = { liked: false, count: 0 }, follow = null } = props;
  const [editing, setEditing] = useState(false);
  /** A view-mode text selection asks edit mode to open on its containing node. */
  const [initialEditSelectionPath, setInitialEditSelectionPath] = useState<string | null>(null);
  /**
   * The comment RAIL is open. Deliberately not in the URL: it is a panel, not
   * a mode, and a comment is already addressable by its anchor. Putting it in
   * the hash is precisely the mistake this replaced.
   */
  const [railOpen, setRailOpen] = useState(false);
  /** `?intent=fork` asked for a copy; the dialog asks the person (lib/intent). */
  const [forkAsked, setForkAsked] = useState(false);
  /** Naming a new folder under THIS one — the shell's only folder-specific act. */
  const [namingFolder, setNamingFolder] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [sharingVerdict, setSharingVerdict] = useState<{ id: string; visibility: Visibility } | null>(null);
  const onVisibilityChange = useCallback((visibility: Visibility) => setSharingVerdict({ id: props.id, visibility }), [props.id]);
  const [socialPreviewOpen, setSocialPreviewOpen] = useState(false);
  /** Desktop comments reserve a rail; on a phone the same surface is a sheet. */
  const phone = useIsPhoneViewport();
  /** A reading preference, separate from the author's stored default. */
  const [readerModeOverride, setReaderModeOverride] = useState<AppearanceMode | null>(null);
  /** Same handoff for the annotation composer. */
  const [initialAnnotationSelection, setInitialAnnotationSelection] = useState<StoryEditSelection | null>(null);
  /** The latest full open-annotation list from the live stream (owner connections only). */
  const [liveAnnotations, setLiveAnnotations] = useState<AnnotationWire[] | null>(null);
  /**
   * The document's session nonce (lib/story-runtime/pristine), learned the
   * moment it announces itself.
   *
   * Held HERE, not in the editor: the runtime announces once, at hydration,
   * and it announces EARLY on purpose — before the author's script exists,
   * which is the whole reason the nonce means anything. The editor mounts long
   * after that, so an editor-held listener hears nothing at all.
   */
  const [sessionNonce, setSessionNonce] = useState<string | null>(null);
  /**
   * Learned the moment the document announces itself — which it does before
   * its author's script exists, and that ordering is the whole reason the
   * nonce means anything (lib/story-runtime/pristine).
   *
   * Held HERE rather than in the editor because the announcement comes at the
   * document's hydration and the editor mounts long afterwards: a listener
   * that attaches with the editor hears nothing, and then every edit the
   * document sends is dropped as unsigned.
   *
   * FIRST announcement wins. A later one is author code trying to be the
   * runtime, and it is already too late.
   */
  // The shell's role signal: the owner's affordances (share, dataset ref
  // copy) and the writer's (edit — an owner or a named editor) hang off it.
  const owner = useArtifactOwner();
  const canEdit = useCanEditArtifact();
  const canAnnotate = useCanAnnotateArtifact();
  /** The layer's own list, when it is mounted: it moves the instant a thread
   * is resolved or opened here, where the stream's copy waits for the ping. */
  const [layerAnnotations, setLayerAnnotations] = useState<AnnotationWire[] | null>(null);
  const openAnnotationCount = (layerAnnotations ?? liveAnnotations)?.filter((a) => a.status === 'open').length ?? openAnnotations;
  /*
   * The floating identity markers are ambient chrome for anyone who may comment, in EVERY
   * mode. The two gates that used to be here — `!editing` and `!annotating` —
   * were the feature: dropping them is what lets someone comment on the
   * paragraph they are editing without leaving to do it.
   */
  const showViewComments = canAnnotate && openAnnotationCount > 0;

  /**
   * `?intent=` — ONE instruction, carried out ONCE, then taken off the address.
   *
   * It is how a door that leads OUT of a document leads back INTO it doing the
   * thing that was asked: "fork this" and "log in to comment" both go through
   * /login, and a person who comes back to a document that has forgotten what
   * they pressed does the work twice.
   *
   * Three things make it safe to act on a URL:
   *  - the ALLOWLIST is the whole parser (lib/intent). This rides on a link
   *    anyone may hand over and anyone may append to, so an unknown value is
   *    silence, and `fork` — the one that writes — ASKS before it does.
   *  - it runs from a ref, ONCE, rather than from a `search`-keyed effect. A
   *    bare replaceState does not move react-router's location, so the `search`
   *    prop still names the intent afterwards; without the ref the page would
   *    re-prompt on every render that reads it.
   *  - the strip is against the LIVE address and keeps everything else byte for
   *    byte — the reader's `$` values (F2) are in this same query string, and
   *    their place in the document is in the hash.
   */
  /**
   * Markup and legacy folder surfaces use the document runtime and live stream.
   * Current folder page data goes directly to FolderPage without this surface.
   */
  const isDocumentFormat = format === 'markup' || format === 'folder';
  const isFolder = format === 'folder';

  const intentDone = useRef(false);
  useEffect(() => {
    if (intentDone.current) return;
    intentDone.current = true;
    const intent = readIntent(search || window.location.search);
    if (intent === 'fork') setForkAsked(true);
    // Exactly the comments row's effect, and gated by exactly its capability:
    // opening a rail for someone who may not comment is an empty panel.
    else if (intent === 'comment' && canAnnotate) setRailOpen(true);
    // The document's own control can only ASK (opaque origin, no session); the
    // shell holds the credential, so this is where the field opens. Gated by
    // the same capability the bar's row is, for the same reason.
    else if (intent === 'new-folder' && isFolder && canEdit) setNamingFolder(true);
    // The document's heart and pill can only ASK; a reader who pressed one
    // arrives here (via login, or straight back) and the shell performs it.
    else if (intent === 'like') void toggleLike(true);
    else if (intent === 'follow') void toggleFollow(true);
    const next = stripIntent(window.location.search);
    if (next !== window.location.search) {
      void navigate(window.location.pathname + next + window.location.hash, {replace:true, state:route.state});
    }
  }, [search, canAnnotate, canEdit, isFolder]);

  // The authorized page — never the sandbox — decides which selection actions
  // exist. Whoever may edit gets Edit; whoever may annotate — owner, editor
  // or commenter — gets Annotate; a plain reader gets no bubble at all.
  useEffect(() => {
    if (!sessionNonce || format !== 'markup') return;
    const capabilities = selectionActionCapabilities(canEdit, canAnnotate, !editing);
    runtimeRef.current?.send({
      type: STORY_SELECTION_ACTIONS_MESSAGE,
      ...capabilities,
    } satisfies StorySelectionActionsMessage);
  }, [canAnnotate, canEdit, editing, format, sessionNonce]);

  // Live in BOTH modes: a reader watching an agent fill in a blank document is
  // the whole point of the shared link, and it is the same stream either way.
  // (The editor owns its own syncing while editing, so the subscription here
  // pauses to avoid two writers of the same view.)
  /**
   * A dataset under this document changed. Kept OUT of React state on purpose
   * (see useLiveArtifact's onData): the document has not changed, so this must
   * never re-render the page or take the document-replacement path — that
   * would rebuild every chart to announce that one of them has new rows. It is
   * sent straight to the mounted runtime, which re-runs the queries reading it.
   */
  const onLiveData = useCallback((event: { datasets: string[] }) => {
    runtimeRef.current?.send(
      { type: STORY_DATA_MESSAGE, datasets: event.datasets } satisfies StoryDataUpdate,
    );
  }, []);
  const live = useLiveArtifact(id, editId, version, !editing, undefined, onLiveData, setLiveAnnotations);
  useEffect(() => { if (live || editing) pageDataChanged(); }, [live, editing]);
  const [liveCatalog, setLiveCatalog] = useState<{ id: string; version: number; catalog: DatasetCatalog } | null>(null);
  // Dataset version frames carry rows, not catalog definitions. Re-read the
  // authorized page metadata on this existing stream's wakeup; the viewer
  // keeps its table selection while it adopts new columns/models/stored rows.
  useEffect(() => {
    if (format !== 'dataset' || live?.format !== 'dataset') return;
    let alive = true;
    const minimumVersion = live.version;
    void fetch(`/api/page/artifact/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
      .then(response => response.ok ? response.json() as Promise<{ surface?: { version: number; catalog?: DatasetCatalog } }> : null)
      .then(page => {
        const surface = page?.surface;
        if (alive && surface?.catalog && surface.version >= minimumVersion) {
          setLiveCatalog({ id, version: surface.version, catalog: surface.catalog });
        }
      }).catch(() => { /* Keep the current table; another stream wakeup retries. */ });
    return () => { alive = false; };
  }, [id, format, live]);
  const shownCatalog = liveCatalog?.id === id && liveCatalog.version >= version ? liveCatalog.catalog : props.catalog;

  const liveSource = live && live.format === 'markup' ? live.source : null;
  const shownSource = liveSource ?? source;
  // What the row actually holds — null when nobody has named it. The editor's
  // field must seed from THIS, so an inherited name never becomes an explicit
  // one just because someone opened the editor.
  const storedTitle = live?.title ?? title;
  // What every reader-facing surface says: the stored name, else the document's
  // own first heading (lib/story/title.ts).
  const shownTitle = displayTitle({ title: storedTitle, source: shownSource });
  // Only EDIT is a mode now, so only edit has a title to announce. A rail that
  // is open is not a different state of the document.
  const titleMode = editing ? '[edit mode]' : null;
  const pageTitle = titleMode ? `${shownTitle} ${titleMode}` : shownTitle;

  // The TAB carries the same name. `<title>` is server-rendered from the row as
  // it stood when the page was requested, so a reader who opens a document an
  // agent has not written yet gets "Untitled" in their window list and keeps it
  // for the whole session — the stream repaints the document and the bar, but
  // nothing ever touched document.title. Same derivation, same live source, so
  // the two can never disagree.
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);
  // The stream omits compiledCss when unchanged, so `undefined` means "keep
  // what we have" while `null` means "there is none".
  const shownCss = live && live.compiledCss !== undefined ? live.compiledCss : compiledCss;
  const shownContent = live?.content ?? content;
  // The DESIGN travels with the document (see the events route): an agent that
  // publishes a theme onto a page someone is watching must repaint it, not hand
  // them new content in the design this page happened to load with.
  const shownTheme = live ? live.theme : theme;
  const shownColorMode = live ? live.colorMode : colorMode;
  const shownTemplate = live ? live.template : template;
  // The document and image render from ./raw; changing the key remounts them
  // so the browser refetches instead of showing a stale document.
  const rawKey = live?.editId ?? editId;

  const transportFactory = useCallback(() => createAuthenticatedTransport(id), [id]);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const onController = useCallback((controller: InlineStoryController | null) => {
    runtimeRef.current = controller;
    setSessionNonce(controller?.nonce ?? null);
    setFrameLoaded(!!controller);
  }, []);
  const readerMode = readerModeOverride ?? resolveStoryMode(shownTheme, shownColorMode);
  // Signal changes update this document's store and route, never its initial
  // seed. Only a new artifact identity receives a new runtime and URL seed.
  const initialRuntimeVersion = useMemo(() => version, [id]);
  const initialRuntimeData = useMemo(() => props.runtime?.data ?? {
    nodes: storyUpdateParts(source ?? '')?.nodes ?? [], refData: {},
    dataflow: dataflow ? {...dataflow, values:{...dataflow.values,...readUrlValues(search,dataflow.flow)}} : undefined,
    colorMode: readerMode, template, chrome: true,
  }, [id]);
  const setReaderMode = useCallback((mode: AppearanceMode) => {
    setReaderModeOverride(mode);
    runtimeRef.current?.send({ type: STORY_READER_MODE_MESSAGE, mode });
  }, []);
  useEffect(() => {
    if (editing || !runtimeRef.current) return;
    // A route refresh can catch up with the stream before the lazy runtime
    // mounts. Adopt that prepared document without remounting the reader's
    // store, whose interactive values must survive document revisions.
    if (!live?.nodes) {
      if (version <= initialRuntimeVersion || !props.runtime) return;
      const prepared = props.runtime;
      runtimeRef.current.update({
        type: STORY_DOCUMENT_MESSAGE, nodes: prepared.data.nodes,
        refData: prepared.data.refData,
        ...(prepared.data.dataflow ? {dataflow: {flow: prepared.data.dataflow.flow}} : {}),
        compiledCss: prepared.compiledCss, authorCss: prepared.authorCss,
        authorScript: prepared.authorScript, theme: prepared.theme,
        ...(prepared.data.colorMode ? {colorMode: prepared.data.colorMode} : {}),
      });
      return;
    }
    runtimeRef.current.update({
      type: STORY_DOCUMENT_MESSAGE, nodes: live.nodes,
      ...(live.dataflow ? {dataflow: live.dataflow} : {}),
      compiledCss: live.compiledCss, authorCss: live.authorCss,
      authorScript: live.authorScript, theme: live.theme,
      ...(live.colorMode ? { colorMode: live.colorMode } : {}),
    });
  }, [live, sessionNonce, editing, version, initialRuntimeVersion, props.runtime]);
  useEffect(() => subscribeDocument({runtimeRef}, event => {
    if (!sessionNonce || !isValuesMessage(event.data, sessionNonce)) return;
    const flow = live?.dataflow?.flow ?? dataflow?.flow;
    if (!flow) return;
    const next = writeUrlValues(window.location.search, flow, event.data.values);
    if (next !== window.location.search) void navigate(window.location.pathname + next + window.location.hash, {replace:true, state:route.state});
  }), [sessionNonce, dataflow, live, navigate, route.state]);


  // `#edit` is the only URL state: readable on load (dashboard deep-links), and
  // kept in sync without a navigation so the shared link never changes. This
  // listener is also what makes browser BACK/FORWARD work — a same-document
  // history move only changes the fragment, so hashchange is the signal.
  useEffect(() => {
    const sync = () => {
      if (route.pathname.endsWith('/edit') || window.location.hash === '#edit') { setEditing(true); return; }
      setInitialEditSelectionPath(null);
      // Leaving edit mode UNMOUNTS the editor, and its pending save is a timer
      // inside it — the unmount cancels the save. `done` drains before it calls
      // us, but the browser's back button arrives straight here (that history
      // entry exists precisely so back works), so the last edit before it left
      // in silence. Drain first, then take the editor away.
      if (!editorFlush.current || draining.current) { setEditing(false); return; }
      void drainEditorRef.current().finally(() => setEditing(false));
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [route.hash, route.pathname]);

  /*
   * Fetch the editor bundle while the reader is still reading, so pressing edit
   * swaps in rather than downloading Monaco first.
   *
   * A prefetch owes the page two things. It must be CANCELLED with the component:
   * an uncancelled timer fires into a page that is gone, which in the ui suite is
   * an EnvironmentTeardownError naming whichever module of the editor's graph was
   * still loading (it failed `ui tests (2/2)` on three master runs). And it must
   * SWALLOW its own failure: the import can fail honestly — the reader is offline,
   * or a redeploy replaced the content-addressed chunk this page's build names —
   * and an unhandled rejection is the wrong way to say "the prefetch missed". The
   * real import, when the reader presses edit, is what gets to report.
   */
  useEffect(() => {
    const warm = () => void import('@/components/ArtifactEditor').catch(() => {});
    const w = window as unknown as {
      requestIdleCallback?: (c: () => void) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    if (w.requestIdleCallback) {
      const handle = w.requestIdleCallback(warm);
      return () => w.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(warm, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Whether THIS page load is what pushed `#edit`, so `done` can undo its own
  // history entry instead of stacking another one.
  const pushedEdit = useRef(false);

  // The mounted editor's drain, and whether one is already running (a second
  // hashchange mid-drain must not start a competing save).
  const editorFlush = useRef<(() => Promise<void>) | null>(null);
  const draining = useRef(false);

  const beginEdit = useCallback((selectionPath: string | null) => {
    if (window.location.hash === '#edit') return;
    // pushState, not replaceState: entering edit mode is a place you can come
    // BACK from, and the browser's back button is the obvious way to do it. The
    // hashchange listener above turns that navigation into leaving edit mode.
    setInitialEditSelectionPath(selectionPath);
    void navigate(window.location.pathname + window.location.search + '#edit', {state:route.state});
    pushedEdit.current = true;
    setEditing(true);
  }, []);
  const enterEdit = useCallback(() => beginEdit(null), [beginEdit]);

  /*
   * LIKE AND FOLLOW, performed here. InlineReaderChrome draws the heart and the
   * pill and ASKS; this page holds the session, calls the door, and hands
   * the door's own answer back down so the chrome shows what is true rather
   * than what was hoped. A page with no account walks through login and back
   * with the ask, the way a stranger's document does.
   */
  const likeRef = useRef(like);
  const followRef = useRef(follow);
  const [, redrawReactions] = useState(0);
  const toggleLike = useCallback(async (want?: boolean) => {
    if (!accountSession) {
      void navigate(`/login?callbackUrl=${encodeURIComponent(`${window.location.pathname}${withIntent('', 'like')}`)}`);
      return;
    }
    const next = want ?? !likeRef.current.liked;
    if (next === likeRef.current.liked) return;
    const res = await fetch(`/api/my/artifacts/${id}/like`, { method: next ? 'POST' : 'DELETE', credentials: 'same-origin' }).catch(() => null);
    if (!res?.ok) return;
    likeRef.current = (await res.json()) as { liked: boolean; count: number };
    pageDataChanged();
    redrawReactions(n => n + 1);
  }, [accountSession, id, navigate]);
  const toggleFollow = useCallback(async (want?: boolean) => {
    const target = followRef.current;
    if (!target) return;
    if (!accountSession) {
      void navigate(`/login?callbackUrl=${encodeURIComponent(`${window.location.pathname}${withIntent('', 'follow')}`)}`);
      return;
    }
    const next = want ?? !target.following;
    if (next === target.following) return;
    const res = await fetch(`/api/users/${target.userId}/follow`, { method: next ? 'POST' : 'DELETE', credentials: 'same-origin' }).catch(() => null);
    if (!res?.ok) return;
    const state = (await res.json()) as { following: boolean; count: number };
    followRef.current = { ...target, ...state };
    pageDataChanged();
    redrawReactions(n => n + 1);
  }, [accountSession, navigate]);
  /**
   * Empty the editor's buffer and wait for it to land. The buffer is a timer
   * living inside the editor, so anything that takes the editor away — or races
   * a write against it — has to ask first. Two callers, for the same reason:
   * leaving edit mode, and stamping a comment's anchor (which is itself a CAS
   * edit that the editor would lose a 409 to).
   *
   * Bounded: an editor that cannot reach the server must not strand the person
   * in a document they have already navigated away from, or a comment they have
   * already written.
   */
  const drainEditor = useCallback(async () => {
    const flush = editorFlush.current;
    if (!flush || draining.current) return;
    draining.current = true;
    await Promise.race([flush(), new Promise((r) => setTimeout(r, 3000))]).finally(() => { draining.current = false; });
  }, []);
  // Held in a ref so the hashchange listener (mounted once) always calls the
  // current one without re-subscribing on every render.
  const drainEditorRef = useRef(drainEditor);
  drainEditorRef.current = drainEditor;

  const exitEdit = useCallback(() => {
    // `done` should be the inverse of what got us here. If we pushed the entry,
    // pop it (so the two cancel out and back/forward stay sane); if the user
    // LANDED on #edit — a deep link from the dashboard, a shared url — there is
    // nothing of ours to pop, and going back would leave the app entirely.
    setInitialEditSelectionPath(null);
    if (pushedEdit.current) {
      pushedEdit.current = false;
      history.back();
    } else {
      void navigate(window.location.pathname.replace(/\/edit$/, '') + window.location.search, {replace:true, state:route.state});
      setEditing(false);
    }
  }, []);

  // A capability-gated selection bubble inside the document runtime asks the page
  // to enter a mode. The nonce makes this a runtime request, not author code.
  useEffect(() => {
    const onSelectionAction = (event: {data: unknown}) => {
      if (!sessionNonce) return;
      if (!isEditFrameMessage(event.data, sessionNonce) || event.data.type !== STORY_SELECTION_ACTION_MESSAGE) return;
      /*
       * Re-checked against the SAME rule that granted the bubble, the view-mode
       * half included. Withdrawing the capability does not unsend a click that
       * was already in flight, and an `annotate` landing after `#edit` opened
       * would push the other mode's hash while the editor stays mounted — the
       * page in both modes at once, with the editor's drain contract skipped.
       */
      if (event.data.action === 'select') return; // AnnotationLayer owns the Select tool.
      if (!selectionActionCapabilities(canEdit, canAnnotate, !editing)[event.data.action]) return;
      if (event.data.action === 'edit') {
        beginEdit(event.data.selection.path);
        return;
      }
      // Commenting opens a composer on those words. No hash, no mode, nothing
      // for the other mode's exit contract to be skipped by.
      setInitialAnnotationSelection(event.data.selection);
    };
    return subscribeDocument({runtimeRef}, onSelectionAction);
  }, [beginEdit, canAnnotate, canEdit, editing, sessionNonce]);

  /**
   * Comment on what the EDITOR has selected. The composer belongs to the page
   * either way, so this is the same destination the view-mode bubble reaches —
   * only the surface that asks differs. No mode is entered and no hash moves;
   * the editor stays mounted with its selection and its buffer intact.
   */
  const commentOnSelection = useCallback((selected: StoryEditSelection) => {
    setInitialAnnotationSelection(selected);
  }, []);

  // The contextual editor action remains present in edit mode, so it must honor the
  // editor's same drain-before-leaving contract as the editing bar's `done`.
  const finishEdit = useCallback(async () => {
    await editorFlush.current?.();
    exitEdit();
  }, [exitEdit]);

  const railInset = railOpen && !phone ? RIGHT_RAIL_W : 0;

  /*
   * WHAT THE EDITOR IS GIVEN. Ownership is decided once, on the server, for
   * both browser credentials (lib/viewer's isOwner) — there is no second,
   * client-side notion of it. The LIVE values, not the ones this page was
   * server-rendered with: a reader may have watched an agent write for minutes
   * before pressing edit, and seeding the original would rewind the editor to a
   * document nobody has — and hand it a stale head pointer.
   */
  const editorSeed = canEdit ? {
    id,
    version: live?.version ?? version,
    edit_id: live?.editId ?? editId,
    title: storedTitle,
    markup: shownSource,
    theme: shownTheme, colorMode: shownColorMode, template: shownTemplate, refs,
    compiledCss: shownCss,
    dataflow,
  } : undefined;

  /** Appearance, discussion and owner actions live in settings; fork is a
   * direct action in the reader bar (and the mobile action rail). */
  const documentControls = (close: () => void) => (
    <div className="space-y-4">
      {(props.author?.forkedFrom || (canAnnotate && format === 'markup') || canEdit) && <section aria-label="Document actions">
        <h2 className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Artifact</h2>
        {props.author?.forkedFrom && <p data-mx-forked-from className="px-2 py-2 font-mono text-xs text-muted">
          forked from {props.author.forkedFrom.href
            ? <a href={props.author.forkedFrom.href} aria-label="Open the artifact this was forked from" className="underline">{props.author.forkedFrom.label}</a>
            : props.author.forkedFrom.label}
        </p>}
        {canAnnotate && format === 'markup' && (
          <button
            type="button"
            aria-label="Toggle comments"
            aria-pressed={railOpen}
            onClick={() => { close(); setRailOpen((open) => !open); }}
            className={`${CONTROL_ROW} ${railOpen ? 'bg-accent-soft text-accent' : ''}`}
          >
            <MessageSquare size={14} strokeWidth={1.75} />
            <span className="flex-1">{railOpen ? 'close comments' : 'comments'}</span>
            {openAnnotationCount > 0 && <span className="text-accent">{openAnnotationCount}</span>}
          </button>
        )}
        {/* EDIT IS ALSO RENAME, which is why a folder is offered it: the
            editor's Title field writes `title` through the edit protocol like
            any other change, so a folder needs no rename door of its own — and
            a second one would be a second thing to keep in step. Its BODY is
            editable for the same reason the plan gives: a folder is a document,
            and customising one is editing it. */}
        {canEdit && isDocumentFormat && (
          <>
            <button
              type="button"
              aria-label="Edit artifact"
              onClick={event => { event.currentTarget.blur(); close(); enterEdit(); }}
              className={CONTROL_ROW}
            >
              <Pencil size={14} strokeWidth={1.75} />
              edit artifact
            </button>

          </>
        )}
        {canEdit && !owner && (
          <ShareLink onVisibilityChange={onVisibilityChange} artifactId={id} title={shownTitle} editable format={format} datasetKind={shownCatalog?.kind} variant="menu" className="" onSocialPreview={shownSource !== null && format === 'markup' ? () => { close(); setSocialPreviewOpen(true); } : undefined} />
        )}
        {/* A FOLDER'S ONE EXTRA VERB. It lives in the chrome rather than in the
            document because the document is sandboxed at an opaque origin and
            holds no credential — the price of a folder being a document, and
            the trade the plan states. Renaming is not here: the editor's own
            Title field is the rename, and a second door would be a second
            way for the two to disagree. */}
        {canEdit && isFolder && (
          <button
            type="button"
            aria-label="New folder"
            onClick={() => { close(); setNamingFolder(true); }}
            className={CONTROL_ROW}
          >
            <FolderPlus size={14} strokeWidth={1.75} />
            new folder
          </button>
        )}
      </section>}

      {owner && (
        <section aria-label="Owner actions">
          <h2 className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">owner</h2>
          <CopyAgentPrompt id={id} variant="menu" />
          {/* Owner chrome: a refresh re-fetches
              bytes that every reader of every document naming those URLs is
              then served. Only for a markup document — it is the only format
              that can name an external url at all. */}
          {format === 'markup' && <RefreshAssets id={id} variant="menu" />}
          {format === 'dataset' && (
            <button
              type="button"
              aria-label="Copy dataset reference"
              onClick={() => { void navigator.clipboard?.writeText(shownCatalog ? datasetQuerySnippet(id, shownCatalog, 'data') : `ref:${id}`); setCopiedRef(true); }}
              className={`${CONTROL_ROW} text-accent`}
            >
              {copiedRef ? 'copied dataset reference' : shownCatalog ? `copy query · source="${id}"` : `copy ref:${id}`}
            </button>
          )}
          <ShareLink onVisibilityChange={onVisibilityChange} artifactId={id} title={shownTitle} owner format={format} datasetKind={shownCatalog?.kind} variant="menu" className="" onSocialPreview={canEdit && shownSource !== null && format === 'markup' ? () => { close(); setSocialPreviewOpen(true); } : undefined} />
        </section>
      )}
    </div>
  );

  /** A document is full-bleed. Reading chrome floats over its safe corners;
   * only the contextual editing toolbar reserves any document space.
   *
   * A FOLDER TAKES THIS BRANCH TOO, because a folder IS a document: its
   * scaffold is ordinary markup, it is served through `raw` like any other
   * (server/app admits it beside markup), and the alternative below is the
   * DATA-TIER view, which has nothing to draw for one. */
  if (isDocumentFormat) {
    return (
      <>
        <TrustedUi overlay layer="navigation">
        <InlineReaderChrome onShare={owner ? () => setSharingOpen(true) : undefined} pinned={editing} input={{artifactId:id, share:owner, visibility:sharingVerdict?.id === id ? sharingVerdict.visibility : props.visibility, title:shownTitle, forkBusy:false, author:props.author ?? null, edit:canEdit, ownerBreadcrumb:owner, reactions:{like:{...likeRef.current,href:'#'},follow:followRef.current ? {...followRef.current,href:'#'} : null,comment:{count:openAnnotationCount,href:'#'}}}} onAction={action => {
          if (action === 'like') void toggleLike();
          else if (action === 'follow') void toggleFollow();
          else if (action === 'fork') setForkAsked(true);
          else if (action === 'edit' && canEdit) { if (editing) void finishEdit(); else enterEdit(); }
          else if (action === 'comment') { if (canAnnotate) setRailOpen(value => !value); else void navigate(`/login?callbackUrl=${encodeURIComponent(window.location.pathname + withIntent('', 'comment'))}`); }
          else if (action === 'controls' || action === 'menu') requestPageChrome(action);
        }} />
        {sharingOpen && <ShareLink onVisibilityChange={onVisibilityChange} artifactId={id} title={shownTitle} owner={owner} editable={canEdit} format={format} datasetKind={shownCatalog?.kind} variant="dialog" className="" onClose={() => setSharingOpen(false)} onSocialPreview={shownSource !== null && format === 'markup' ? () => { setSharingOpen(false); setSocialPreviewOpen(true); } : undefined} />}
        {editing ? (
          /* EDIT MODE: the document's own bar stays, PINNED at the top, and the
             editor's toolbar sits under it. The panels drop below both. */
          <>
            <PageMenu authed={accountSession} anon={anonSession} title={shownTitle} fixed triggerless panelTop={APP_BAR_H + EDIT_BAR_H + 8} />
            <PageControls fixed triggerless label="Artifact controls" mode={readerMode} onModeChange={setReaderMode} active={railOpen} badge={openAnnotationCount} panelTop={APP_BAR_H + EDIT_BAR_H + 8}>
              {documentControls}
            </PageControls>
          </>
        ) : (
          /* InlineReaderChrome draws the chrome (logo, rail, byline) — the same
             one a stranger sees — and asks this page to open these. */
          <>
            <PageMenu authed={accountSession} anon={anonSession} title={shownTitle} fixed triggerless />
            <PageControls
              fixed
              triggerless
              rightOffset={railOpen && !phone ? RIGHT_RAIL_W + 12 : 12}
              label="Artifact controls"
              mode={readerMode}
              onModeChange={setReaderMode}
              active={railOpen}
              badge={openAnnotationCount}
            >
              {documentControls}
            </PageControls>
          </>
        )}
        </TrustedUi>
        <div
          aria-label="Artifact viewport"
          className="relative min-h-screen"
          style={{
            // Edit/annotation controls change the inset, not runtime identity.
            paddingTop: (phone ? 0 : APP_BAR_H) + (editing ? EDIT_BAR_H : 0),
            paddingRight: railInset,
            right: 0,
            background: readerMode === 'dark' ? DOCUMENT_GROUND.dark : DOCUMENT_GROUND.light,
          }}
        >
          {/* Loading ink must read on both fallback grounds before the runtime is ready. */}
          {!frameLoaded && (
            <div
              aria-label="Loading document"
              className="absolute inset-0 flex items-center justify-center font-mono text-xs"
              style={{ color: '#8b8b90' }}
            >
              loading…
            </div>
          )}
          <InlineStoryRuntime
            key={id}
            data={initialRuntimeData}
            transportFactory={transportFactory}
            prepared={props.runtime}
            authorScript={props.runtime?.authorScript}
            onController={onController}
          />
        </div>
        {/* Annotations are chrome too: pins live IN the document runtime, markers and
            threads on the page (which holds the content and the session).
            Mounted in EVERY mode — the `!editing` gate that used to be here is
            exactly what made commenting mid-edit a four-navigation detour. */}
        <TrustedUi overlay>
        {canAnnotate && (
          <AnnotationLayer
            id={id}
            runtimeRef={runtimeRef}
            sessionNonce={sessionNonce}
            railOpen={railOpen}
            liveAnnotations={liveAnnotations}
            showViewComments={showViewComments}
            onRailOpenChange={setRailOpen}
            initialSelection={initialAnnotationSelection}
            pickOnOpen={!editing}
            // Under the document's bar (44px on desktop; a phone draws no bar
            // and gets a sheet anyway), and under the editor toolbar too.
            topOffset={(phone ? 0 : APP_BAR_H) + (editing ? EDIT_BAR_H : 0)}
            onAnnotationsChange={setLayerAnnotations}
          />
        )}
        {/* Edit mode is CHROME around the document, not a replacement for it. */}
        {editing && (
          <ArtifactEditor
            id={id}
            seed={editorSeed}
            onExit={finishEdit}
            flushRef={editorFlush}
            runtimeRef={runtimeRef}
            sessionNonce={sessionNonce}
            initialSelectionPath={initialEditSelectionPath}
            onComment={canEdit ? commentOnSelection : undefined}
          />
        )}
        {forkAsked && <ForkConfirm id={id} title={shownTitle} onClose={() => setForkAsked(false)} />}
        {namingFolder && canEdit && isFolder && (
          <NewFolderPrompt parentId={id} onClose={() => setNamingFolder(false)} />
        )}
        {socialPreviewOpen && shownSource !== null && (
          <SocialPreviewDialog
            id={id}
            source={shownSource}
            editId={live?.editId ?? editId}
            version={live?.version ?? version}
            onClose={() => setSocialPreviewOpen(false)}
          />
        )}
        </TrustedUi>
      </>
    );
  }

  // The data tiers are VALUES, not documents: they read as a table, a recipe
  // or an image inside the app's own measure.
  return (
    <>
      <PageChrome authed={accountSession} anon={anonSession} title={shownTitle} label="Artifact controls" actions={<ForkArtifact id={id} title={shownTitle} variant="bar" />}>
        {documentControls}
      </PageChrome>
      <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-6">
      {format === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element -- the artifact IS the image; no optimizer.
        <img key={rawKey} src={`/a/${id}/raw`} alt={shownTitle} className="mt-4 max-w-full rounded-[6px] border border-edge" />
      )}

      {(format === 'pdf' || format === 'file') && (
        // A PDF is a FILE, not something the app renders: the browser's own
        // viewer does that, at /raw, which is served inline and sandboxed. So
        // this view is the two facts a person picks a file by and the link that
        // opens it — the same card <File> draws inside a document.
        <div className="mt-4 rounded-[6px] border border-edge bg-surface p-4">
          <p className="font-sans text-xs text-muted" aria-label={format === 'pdf' ? 'PDF summary' : 'File summary'}>
            {format === 'pdf' ? 'PDF' : 'File'}{fileBytes ? ` · ${formatFileSize(fileBytes)}` : ''}{filePages ? ` · ${filePages} page${filePages === 1 ? '' : 's'}` : ''}
          </p>
          <a
            aria-label={format === 'pdf' ? 'Open the PDF' : 'Download file'}
            href={`/a/${id}/raw`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block font-sans text-sm underline underline-offset-2"
          >
            {format === 'pdf' ? 'Open' : 'Download'} {shownTitle}
          </a>
        </div>
      )}

      {format === 'dataset' && shownCatalog && <DatasetCatalogView id={id} catalog={shownCatalog} canEdit={canEdit} />}
      {format === 'dataset' && !shownCatalog && (
        <>
          <p className="mt-4 font-sans text-xs text-muted" aria-label="Dataset summary">
            {safeRows(shownContent).length.toLocaleString()} rows · {columns.length} columns
            {safeRows(shownContent).length > 50 && <span className="text-faint"> · showing the first 50</span>}
          </p>
          <div className="mt-2 max-h-[70vh] overflow-auto rounded-[6px] border border-edge">
          <table className="w-full border-collapse font-mono text-xs">
            <thead className="sticky top-0 z-10 bg-raised">
              <tr className="border-b border-edge text-left text-faint">
                {(columns.length ? columns : Object.keys(safeRows(shownContent)[0] ?? {}).map((name) => ({ name, type: undefined }))).map((c) => (
                  <th key={c.name} className="whitespace-nowrap px-3 py-2 font-normal">
                    {c.name}
                    {c.type && <span className="ml-1.5 text-[10px] text-faint">{c.type}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {safeRows(shownContent).slice(0, 50).map((row, i) => (
                <tr key={i} className="border-b border-edge/50 text-muted">
                  {(columns.length ? columns.map((c) => c.name) : Object.keys(row)).map((name) => (
                    <td key={name} className="whitespace-nowrap px-3 py-1.5">
                      {/* A blank cell is MISSING; rendering it as '' makes an
                          absent value indistinguishable from an empty string. */}
                      {row[name] === null || row[name] === undefined
                        ? <span className="text-faint">—</span>
                        : String(row[name])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}

      {format === 'viz' && (
        <pre className="mt-4 overflow-x-auto rounded-[6px] border border-edge bg-surface p-4 font-mono text-xs text-muted">
          {shownContent}
        </pre>
      )}

      </main>
      {forkAsked && <ForkConfirm id={id} title={shownTitle} onClose={() => setForkAsked(false)} />}
    </>
  );
}
