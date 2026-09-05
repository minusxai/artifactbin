'use client';

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
import { Crop, FolderPlus, MessageSquare, Pencil } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useArtifactOwner, useCanAnnotateArtifact, useCanEditArtifact } from '@/components/ArtifactShell';
import AnnotationLayer from '@/components/AnnotationLayer';
import CopyAgentPrompt from '@/components/CopyAgentPrompt';
import RefreshAssets from '@/components/RefreshAssets';
import ForkArtifact, { ForkConfirm } from '@/components/ForkArtifact';
import { LikeButton } from '@/components/LikeButton';
import ShareLink from '@/components/ShareLink';
import type { AnnotationWire } from '@/lib/annotations';
import { readIntent, stripIntent } from '@/lib/intent';
import { notifyPageChromeScroll, PageChromeBar, PageControls, PageMenu, type AppearanceMode } from '@/components/PageChrome';
import { useIsPhoneViewport } from '@/components/MobileSheet';
/* The editing bar's height is RESERVED by this page, never measured — and it
 * comes from a leaf module, because importing it from the editor would put the
 * editor in every reader's bundle (lib/__tests__/reader-bundle-hygiene). */
import { EDIT_BAR_H, RIGHT_RAIL_W } from '@/lib/story/edit-bar';
import type { ArtifactFormat } from '@/lib/story/input';
import { useLiveArtifact } from '@/lib/story/use-live-artifact';
import { STORY_ASSET_MESSAGE, STORY_ASSET_RESULT_MESSAGE, type StoryAssetRequest, type StoryAssetResult, STORY_DATA_MESSAGE, STORY_DOCUMENT_ACK_MESSAGE, STORY_DOCUMENT_MESSAGE, STORY_HELLO_MESSAGE, STORY_MUTATE_MESSAGE, STORY_MUTATE_RESULT_MESSAGE, STORY_PAINTED_MESSAGE, STORY_READER_MODE_MESSAGE, STORY_SCROLL_MESSAGE, type StoryDataUpdate, type StoryMutateRequest, type StoryMutateResult, type StoryScrollMessage, STORY_ADOPTS_MESSAGE, STORY_QUERY_MESSAGE, STORY_QUERY_RESULT_MESSAGE, isEditFrameMessage, isSessionMessage, isValuesMessage, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE, type StoryDocumentUpdate, type StoryEditSelection, type StoryQueryRequest, type StoryQueryResult, type StorySelectionActionsMessage } from '@/lib/story-runtime/contract';
import type { DataflowState } from '@/lib/story/dataflow';
import { urlValuesSearch, writeUrlValues } from '@/lib/story/url-values';
import { displayTitle } from '@/lib/story/title';
import { formatFileSize } from '@/lib/file-display';
import { resolveStoryMode } from '@/lib/data/story/story-themes';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import type { StoryIslandDataflow } from '@/lib/story-runtime/contract';

const ArtifactEditor = dynamic(() => import('@/components/ArtifactEditor'), {
  ssr: false,
  loading: () => <p className="mt-10 text-center text-xs text-faint">loading the editor…</p>,
});

const SocialPreviewDialog = dynamic(() => import('@/components/SocialPreviewDialog'), {
  ssr: false,
  loading: () => <p className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 font-mono text-xs text-white">loading preview…</p>,
});

export interface ArtifactSurfaceProps {
  /**
   * The exporter's signed key, when this render IS a capture (server-parsed
   * from `?key=`). Null for every human render.
   */
  captureKey?: string | null;
  id: string;
  /** Head pointer at render time — the baseline the live stream is compared against. */
  editId: string;
  format: ArtifactFormat;
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
   * are the reader's `<Value>` selection and are forwarded into the framed
   * document; everything else in it is the page's business, not the
   * document's, and is deliberately left behind.
   */
  search?: string;
  /** An ACCOUNT session (NextAuth) holds this browser — the bar offers Sign out. */
  accountSession?: boolean;
  /** An ANONYMOUS session (agent cookie, no account) — the bar offers Disconnect. */
  anonSession?: boolean;
  version: number;
  /** Open-annotation count at render time (owners only) — seeds the annotate button's badge; live frames keep it current. */
  openAnnotations?: number;
  /**
   * The viewer's like state and the document's like count, from the page's own
   * fetch. Optional because every other render of this surface (the export
   * capture, the ui suite's fixtures) has nobody to ask.
   */
  like?: { liked: boolean; count: number };
  content: string;
  columns: Array<{ name: string; type?: string }>;
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
 * How long a revealed frame has to answer `mx:hello` before we call it dead.
 * Generous on purpose: the cost of waiting is a moment of a page that is
 * probably fine, and the cost of being wrong is throwing away a live document.
 */
const FRAME_LIVENESS_GRACE_MS = 1500;

/**
 * How long a document has to say it adopted a new version before we conclude
 * it cannot, and replace the frame instead. Generous: the cost of waiting is a
 * moment of a document one edit behind, and the cost of being early is the
 * reload this path exists to avoid.
 */
/** How long a freshly painted document has to load its runtime and say so. */
const ANNOUNCE_GRACE_MS = 2500;
const DOCUMENT_ASK_INTERVAL_MS = 300;
const DOCUMENT_ASKS = 10;   // ~3s before concluding this document cannot adopt

/**
 * What a document's own page is standing on while its frame loads. Neutral by
 * mode rather than themed: the document's real background lives in its own
 * stylesheet, which the page has not got, and any colour is better than the
 * white the revealed frame used to flash under every dark document.
 */
const DOCUMENT_GROUND = { light: '#ffffff', dark: '#0b0b0c' } as const;

const CONTROL_ROW = 'flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-2 text-left font-mono text-xs text-muted transition-colors hover:bg-raised hover:text-fg';

/** The frame's own url with the reader's `$` selection on the end (or unchanged). */
const appendSelection = (query: string, selection: string): string =>
  (selection ? `${query}${query ? '&' : '?'}${selection}` : query);

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
 * what it sends back — the frame is sandboxed markup and never an authority.
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
  const [copiedRef, setCopiedRef] = useState(false);
  const { id, editId, format, title, source, content, columns, bytes: fileBytes = 0, pages: filePages = null, compiledCss, theme, colorMode, template, refs, dataflow = null, search = '', accountSession = false, anonSession = false, version, captureKey = null, openAnnotations = 0, like = { liked: false, count: 0 } } = props;
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
  useEffect(() => {
    const onSession = (e: MessageEvent) => {
      if (!e.isTrusted) return;
      if (frameRef.current && e.source !== frameRef.current.contentWindow) return;
      if (!isSessionMessage(e.data)) return;
      const announced = e.data.nonce;
      setSessionNonce((held) => held ?? announced);
    };
    window.addEventListener('message', onSession);
    return () => window.removeEventListener('message', onSession);
  }, []);
  // The shell's role signal: the owner's affordances (share, dataset ref
  // copy) and the writer's (edit — an owner or a named editor) hang off it.
  const owner = useArtifactOwner();
  const canEdit = useCanEditArtifact();
  const canAnnotate = useCanAnnotateArtifact();
  const openAnnotationCount = liveAnnotations?.length ?? openAnnotations;
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
   * The two formats the shell serves as a DOCUMENT — the frame, its live
   * stream and the editor — rather than as a value the app draws itself.
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
    const next = stripIntent(window.location.search);
    if (next !== window.location.search) {
      window.history.replaceState(null, '', window.location.pathname + next + window.location.hash);
    }
  }, [search, canAnnotate, canEdit, isFolder]);

  // The authorized page — never the sandbox — decides which selection actions
  // exist. Whoever may edit gets Edit; whoever may annotate — owner, editor
  // or commenter — gets Annotate; a plain reader gets no bubble at all.
  useEffect(() => {
    if (!sessionNonce || format !== 'markup') return;
    const capabilities = selectionActionCapabilities(canEdit, canAnnotate, !editing);
    frameRef.current?.contentWindow?.postMessage({
      type: STORY_SELECTION_ACTIONS_MESSAGE,
      ...capabilities,
    } satisfies StorySelectionActionsMessage, '*');
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
   * posted straight into the frame, which re-runs the queries reading it.
   */
  const onLiveData = useCallback((event: { datasets: string[] }) => {
    frameRef.current?.contentWindow?.postMessage(
      { type: STORY_DATA_MESSAGE, datasets: event.datasets } satisfies StoryDataUpdate,
      '*',
    );
  }, []);
  const live = useLiveArtifact(id, editId, version, !editing, undefined, onLiveData, setLiveAnnotations);
  /*
   * THE READER'S `<Value>` SELECTION, AND THE ADDRESS BAR (lib/story/url-values).
   *
   * Two halves that must not be confused with each other:
   *
   *  - the frame is SEEDED once, from the link this page was opened at. The
   *    `src` must then never change again, because a `src` write NAVIGATES the
   *    frame: a full document reload, every chart rebuilt, the reader's place
   *    gone — once per pick, and it would look entirely correct while doing it.
   *    So the seed is state that moves only when the frame is being replaced
   *    anyway (`frameNonce`), never with the live address.
   *  - the ADDRESS follows the picks. A framed document cannot write it: the
   *    `location` its own capability reaches is the FRAME's, so it would move
   *    `/a/<id>/raw?edit=1`, which nobody can copy (measured on the spike).
   *    It reports instead, and this page writes — re-deriving the whole search
   *    through `writeUrlValues` against the flow it holds, because the frame is
   *    sandboxed markup and never an authority about what this document
   *    declares.
   */
  const selectionRef = useRef(urlValuesSearch(search));
  const [frameSearch, setFrameSearch] = useState(selectionRef.current);
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

  /**
   * Whether the document's own frame has painted. Until it has, the frame is
   * transparent over the document's ground with a loading indicator on it.
   * The document renders in the frame and NOWHERE else on this page: the page
   * used to carry a server-rendered copy of its markup to paint underneath,
   * for crawlers — and crawlers stopped arriving here when readers started
   * getting the document top-level (proxy.ts). Only an owner sees this shell,
   * and an owner can watch a loader.
   */
  const [frameLoaded, setFrameLoaded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /**
   * Bumped to throw away a frame whose document is gone (see the liveness
   * check below). It rides in the iframe's `key` beside `rawKey`, so the only
   * way to replace a frame is still to replace the element.
   */
  const [frameNonce, setFrameNonce] = useState(0);
  /** Whether the frame has answered since we last asked. */
  const frameAliveRef = useRef(false);

  /** The document owns the scroll port, while the mobile action bar lives in
   * this parent page. Accept direction samples only from our current frame;
   * its opaque origin cannot identify it, but its WindowProxy can. */
  useEffect(() => {
    if (format !== 'markup') return;
    const onScroll = (event: MessageEvent) => {
      const data = event.data as Partial<StoryScrollMessage> | undefined;
      if (!data || data.type !== STORY_SCROLL_MESSAGE || typeof data.scrollY !== 'number') return;
      if (frameRef.current && event.source !== frameRef.current.contentWindow) return;
      // Read leniently: a document served before `atBottom` existed posts
      // without it, and "no flag" must mean "not at the end", never a crash.
      notifyPageChromeScroll(data.scrollY, data.atBottom === true);
    };
    window.addEventListener('message', onScroll);
    return () => window.removeEventListener('message', onScroll);
  }, [format]);

  const readerMode = readerModeOverride ?? resolveStoryMode(shownTheme, shownColorMode);
  const setReaderMode = useCallback((mode: AppearanceMode) => {
    setReaderModeOverride(mode);
    frameRef.current?.contentWindow?.postMessage({ type: STORY_READER_MODE_MESSAGE, mode }, '*');
  }, []);

  // A reclaimed/replaced frame starts as a fresh document. Re-apply the
  // reader's preference when its new runtime announces itself.
  useEffect(() => {
    if (!readerModeOverride || !sessionNonce) return;
    frameRef.current?.contentWindow?.postMessage({ type: STORY_READER_MODE_MESSAGE, mode: readerModeOverride }, '*');
  }, [frameNonce, readerModeOverride, sessionNonce]);

  /**
   * A REPLACED frame is a NEW DOCUMENT, and the nonce it announces is its own.
   * FIRST-ANNOUNCEMENT-WINS is a rule about author code racing the runtime
   * INSIDE one document — not about the page refusing to learn the successor's.
   * Holding the dead frame's nonce made every signed message from the new one
   * unreadable: its edits, its annotations and its selection actions all
   * arrived correctly signed against a session the page had thrown away.
   */
  useEffect(() => {
    if (frameNonce === 0) return;
    setSessionNonce(null);
  }, [frameNonce]);

  /**
   * The document tells us when it has PARSED, which is when it is visually
   * ready. `load` is the wrong signal: it waits for every subresource, so the
   * fallback stayed up until the whole runtime had downloaded.
   *
   * The frame is opaque-origin, so `event.origin` is "null" for every message
   * it sends and cannot identify it — the identity check is the SOURCE window.
   */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data !== STORY_PAINTED_MESSAGE) return;
      if (frameRef.current && e.source !== frameRef.current.contentWindow) return;
      // The same answer serves twice: it reveals the frame the first time, and
      // afterwards it is the proof of life the check below is waiting for.
      frameAliveRef.current = true;
      setFrameLoaded(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /**
   * The QUERY RELAY (lib/story-runtime/contract.ts): the document asks, the
   * page — which holds the session — calls /a/<id>/query and answers. Same
   * identity rule as above: the frame is known by its SOURCE window, never by
   * origin ("null"). Every answer goes back to the window that asked, so a
   * replaced frame cannot receive a stale one.
   */
  useEffect(() => {
    const onQuery = async (e: MessageEvent) => {
      const data = e.data as Partial<StoryQueryRequest> | undefined;
      if (!data || typeof data !== 'object' || data.type !== STORY_QUERY_MESSAGE) return;
      if (frameRef.current && e.source !== frameRef.current.contentWindow) return;
      const reply = (msg: StoryQueryResult) => (e.source as Window | null)?.postMessage(msg, '*');
      try {
        const res = await fetch(`/a/${id}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: data.values ?? {}, only: data.only ?? [], ...(data.page ? { page: data.page } : {}) }),
        });
        if (!res.ok) { reply({ type: STORY_QUERY_RESULT_MESSAGE, id: data.id!, error: `query failed (${res.status})` }); return; }
        const body = (await res.json()) as { tables: DataflowState['tables']; errors: DataflowState['errors'] };
        reply({ type: STORY_QUERY_RESULT_MESSAGE, id: data.id!, tables: body.tables, errors: body.errors });
      } catch (err) {
        reply({ type: STORY_QUERY_RESULT_MESSAGE, id: data.id!, error: err instanceof Error ? err.message : 'query failed' });
      }
    };
    window.addEventListener('message', onQuery);
    return () => window.removeEventListener('message', onQuery);
  }, [id]);

  /**
   * THE ASSET RELAY — the same shape and the same reason as the two around it:
   * the frame is opaque-origin, so an `<img>` it loads carries no cookie, and
   * `/a/<id>/assets` then sees an anonymous caller from inside every framed
   * document. On a PRIVATE one — which is what a signed-in user's document is
   * by default — that is the uniform 404, for its own owner as much as anyone.
   *
   * So the page asks, with its session, and posts back the ADDRESS of our copy.
   * What crosses is `/assets/<hash>`, which needs no credential at all
   * (content-addressed from the URL, serving nothing the source host does not):
   * never bytes, and never a credential.
   *
   * The CAPTURE carries the export key instead of a session — the headless
   * browser has none — on exactly the terms `raw` admits it. Without that a
   * private document's og image photographs alt text.
   */
  useEffect(() => {
    const onAsset = async (e: MessageEvent) => {
      const data = e.data as Partial<StoryAssetRequest> | undefined;
      if (!data || typeof data !== 'object' || data.type !== STORY_ASSET_MESSAGE || typeof data.url !== 'string') return;
      if (frameRef.current && e.source !== frameRef.current.contentWindow) return;
      const reply = (msg: StoryAssetResult) => (e.source as Window | null)?.postMessage(msg, '*');
      try {
        const key = captureKey ? `&key=${encodeURIComponent(captureKey)}` : '';
        const res = await fetch(`/a/${id}/assets?u=${encodeURIComponent(data.url)}${key}`, { headers: { Accept: 'application/json' } });
        const body = (await res.json().catch(() => ({}))) as { url?: string; code?: string };
        if (res.ok && body.url) reply({ type: STORY_ASSET_RESULT_MESSAGE, id: data.id!, url: body.url });
        else reply({ type: STORY_ASSET_RESULT_MESSAGE, id: data.id!, refused: body.code ?? `http_${res.status}` });
      } catch {
        reply({ type: STORY_ASSET_RESULT_MESSAGE, id: data.id!, refused: 'fetch_failed' });
      }
    };
    window.addEventListener('message', onAsset);
    return () => window.removeEventListener('message', onAsset);
  }, [id, captureKey]);

  /**
   * The WRITE RELAY — the same shape as the query relay above, and here for
   * the same reason: the frame is opaque-origin and cannot present a session,
   * so a PRIVATE document's writes can only happen through the page. A public
   * document served top-level POSTs for itself and never reaches this.
   *
   * The frame is identified by its SOURCE window, never by origin ("null"),
   * and the answer goes back to the window that asked.
   */
  useEffect(() => {
    const onMutate = async (e: MessageEvent) => {
      const data = e.data as Partial<StoryMutateRequest> | undefined;
      if (!data || typeof data !== 'object' || data.type !== STORY_MUTATE_MESSAGE) return;
      if (frameRef.current && e.source !== frameRef.current.contentWindow) return;
      const reply = (msg: StoryMutateResult) => (e.source as Window | null)?.postMessage(msg, '*');
      try {
        const res = await fetch(`/a/${id}/mutate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mutation: data.mutation, values: data.values ?? {} }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; dataset?: string; version?: number; affected?: number; error?: string; detail?: string };
        if (!res.ok || !body.ok) {
          reply({ type: STORY_MUTATE_RESULT_MESSAGE, id: data.id!, ok: false, error: body.detail ?? body.error ?? `write failed (${res.status})` });
          return;
        }
        reply({ type: STORY_MUTATE_RESULT_MESSAGE, id: data.id!, ok: true, dataset: body.dataset ?? '', version: body.version ?? 0, affected: body.affected ?? 0 });
      } catch (err) {
        reply({ type: STORY_MUTATE_RESULT_MESSAGE, id: data.id!, ok: false, error: err instanceof Error ? err.message : 'write failed' });
      }
    };
    window.addEventListener('message', onMutate);
    return () => window.removeEventListener('message', onMutate);
  }, [id]);



  /**
   * The frame says which `<Value>`s the reader has chosen; this page writes the
   * address so the link they copy is the document they are looking at.
   *
   * `replaceState`, never `pushState`: a pick is not a navigation, and a back
   * button that walked a reader through every filter they tried is a worse
   * document than one they cannot go back in at all.
   */
  useEffect(() => {
    const onValues = (e: MessageEvent) => {
      if (frameRef.current && e.source !== frameRef.current.contentWindow) return;
      if (!sessionNonce || !isValuesMessage(e.data, sessionNonce)) return;
      // The flow the PAGE holds — the served one, or the live version if an
      // agent has since changed the declarations.
      const flow = live?.dataflow?.flow ?? dataflow?.flow ?? null;
      if (!flow) return;
      const next = writeUrlValues(window.location.search, flow, e.data.values);
      // What a REPLACED frame should be seeded with, if one ever is.
      selectionRef.current = urlValuesSearch(next);
      if (next === window.location.search) return;
      window.history.replaceState(null, '', window.location.pathname + next + window.location.hash);
    };
    window.addEventListener('message', onValues);
    return () => window.removeEventListener('message', onValues);
  }, [sessionNonce, dataflow, live]);

  // A new FRAME is hidden again until it has painted. Keyed on the nonce, not
  // on the document: a live edit no longer replaces the frame (see below), and
  // hiding a live document to announce an edit to it was the flash this whole
  // path exists to remove.
  useEffect(() => { setFrameLoaded(false); }, [frameNonce]);
  /*
   * A REPLACED frame is a new document load, so it is the one moment the seed
   * may move — and must: a frame replaced after the reader has narrowed the
   * document should come back narrowed. Every other render keeps `src` byte
   * for byte, which is what stops a pick from reloading the document.
   */
  useEffect(() => { setFrameSearch(selectionRef.current); }, [frameNonce]);

  /*
   * Editing does NOT reset this, and that is the point.
   *
   * It used to: edit mode unmounted the frame, so coming back was a new frame
   * that had painted nothing, and leaving the old reveal in force showed it
   * opaque and empty. Now editing happens in the frame that is already there —
   * so hiding it on the way in would blank the very document the user came to
   * edit, for as long as they edited it.
   */

  /**
   * A LIVE EDIT IS DELIVERED TO THE DOCUMENT, NOT AROUND IT.
   *
   * This page owns the stream (an opaque frame cannot hold an EventSource
   * against our origin), and it used to deliver what it heard by replacing the
   * frame: the document re-fetched, re-parsed and re-hydrated, every chart
   * rebuilt, the reader's place on the page gone — once per agent write. The
   * document can re-render itself, so it is handed the new version instead.
   *
   * It ACKS, and silence is meaningful: a document with no components ships no
   * runtime, and one whose hydration failed is still on screen. Either way the
   * reader must not be left on a version that has moved on, so an unanswered
   * update falls back to replacing the frame — the old behaviour, now the
   * exception rather than the rule.
   */
  /*
   * THE READER'S PLACE NEEDS NO CARRYING ANY MORE.
   *
   * This page used to hold the reading position and hand it between the
   * document's two renderings — the served frame and the edit canvas — because
   * they were different documents at different widths and a pixel offset meant
   * nothing across the boundary. There is one document now. Entering and
   * leaving edit mode do not move it, so there is nothing to capture, nothing
   * to restore, and no moment where the reader could be put back wrong.
   */

  /**
   * Whether the document in the frame can take an update at all. A document
   * with no components ships no runtime (lib/story/document needsRuntime), so
   * for those the frame is still replaced — immediately, rather than after the
   * ask loop below has given up on a document that was never listening.
   */
  const frameAdoptsRef = useRef(false);
  useEffect(() => {
    const onAdopts = (e: MessageEvent) => {
      if (e.data !== STORY_ADOPTS_MESSAGE) return;
      if (frameRef.current && e.source !== frameRef.current.contentWindow) return;
      frameAdoptsRef.current = true;
    };
    window.addEventListener('message', onAdopts);
    return () => window.removeEventListener('message', onAdopts);
  }, []);
  // A replaced frame is a different document until it says otherwise.
  useEffect(() => { frameAdoptsRef.current = false; }, [frameNonce]);
  /**
   * When this frame painted, or when we started waiting for it to — the clock
   * the announcement is judged against.
   * A document that has just appeared may simply not have loaded its runtime
   * yet (it is a ~1.3MB module, and the document announces itself only once it
   * runs), and treating "has not said so YET" as "cannot" turns a slow link
   * into a reload for every reader on one.
   */
  const paintedAtRef = useRef(Date.now());
  useEffect(() => { if (frameLoaded) paintedAtRef.current = Date.now(); }, [frameLoaded]);

  const adoptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (format !== 'markup' || !live || live.editId === adoptedRef.current) return;
    adoptedRef.current = live.editId;
    const win = frameRef.current?.contentWindow;
    // Nothing to talk to, or a version we cannot describe (source that no longer
    // parses): replace the frame and let the server render it.
    //
    // …and likewise a document that has been on screen long enough to have
    // announced itself and has not: that one ships no runtime at all, and
    // asking it repeatedly is a reader watching an edit that has already been
    // made. Anything younger gets the benefit of the doubt.
    const settled = Date.now() - paintedAtRef.current > ANNOUNCE_GRACE_MS;
    if (!win || !live.nodes || (!frameAdoptsRef.current && settled)) { setFrameNonce((n) => n + 1); return; }

    let acked = false;
    const onAck = (e: MessageEvent) => {
      if (e.data === STORY_DOCUMENT_ACK_MESSAGE && e.source === frameRef.current?.contentWindow) acked = true;
    };
    window.addEventListener('message', onAck);
    const update: StoryDocumentUpdate = {
      type: STORY_DOCUMENT_MESSAGE,
      nodes: live.nodes,
      ...(live.dataflow ? { dataflow: live.dataflow } : {}),
      ...(live.compiledCss !== undefined ? { compiledCss: live.compiledCss } : {}),
      ...(live.authorCss !== undefined ? { authorCss: live.authorCss } : {}),
      theme: live.theme,
      ...(live.colorMode ? { colorMode: live.colorMode } : {}),
    };
    /*
     * Asked repeatedly, for the same reason the position is: the runtime is a
     * module that loads after the document says it has painted, so the first
     * ask routinely lands before anything is listening. Replacing the frame is
     * the answer to "this document cannot adopt updates", not to "it was still
     * loading when we asked".
     */
    let asks = 0;
    const ask = () => {
      if (acked) { window.clearInterval(timer); return; }
      if (++asks > DOCUMENT_ASKS) {
        window.clearInterval(timer);
        setFrameNonce((n) => n + 1);
        return;
      }
      win.postMessage(update, '*');
    };
    ask();
    const timer = window.setInterval(ask, DOCUMENT_ASK_INTERVAL_MS);
    return () => { window.clearInterval(timer); window.removeEventListener('message', onAck); };
  }, [live, format]);

  /**
   * The other half of that signal — ASKING, not only listening.
   *
   * Everything above is the document talking: a burst of posts that ends after
   * ~3s, plus an `onLoad` belt that only catches a load happening after this
   * component hydrated. A page that hydrates late misses both, and then keeps
   * a live document transparent behind the loader indefinitely. So we ask
   * until told, and
   * if the frame never answers at all we reveal it anyway: a document we
   * cannot hear is still a document, and hiding it is the worse failure.
   */
  useEffect(() => {
    // Nothing to ask while the editor holds the page: the loop used to keep
    // counting through an edit session and reveal a frame that did not exist.
    if (frameLoaded || editing) return;
    let asked = 0;
    const ask = () => {
      frameRef.current?.contentWindow?.postMessage(STORY_HELLO_MESSAGE, '*');
      if (++asked >= 20) { clearInterval(timer); setFrameLoaded(true); }
    };
    const timer = setInterval(ask, 250);
    ask();
    return () => clearInterval(timer);
  }, [frameLoaded, editing, frameNonce]);

  /**
   * ...and asking again on the way BACK IN, because revealing the frame is
   * otherwise a one-way latch.
   *
   * Once the frame answers we unmount the page's own copy of the text and paint
   * the frame opaque over the whole viewport — so from then on the frame IS the
   * page. But this frame is sandboxed without `allow-same-origin`, which makes
   * it opaque-origin, which makes Chrome site-isolate it into its own renderer:
   * exactly the process a backgrounded tab loses first under memory pressure.
   * The browser does not reload a frame it reclaimed, and we were no longer
   * listening, so the reader came back to a white rectangle with no text and no
   * way out but a refresh.
   *
   * The document answers `mx:hello` for as long as it is alive (lib/story/
   * document.ts) — so asking is the liveness test, and silence is the answer.
   * Deliberately only while VISIBLE: a hidden tab throttles timers to once a
   * minute, so the grace window there measures nothing.
   *
   * A frame that fails it is REPLACED rather than reloaded (`frameNonce` in the
   * key): whatever state a dead document's window is in, it is not ours to
   * repair, and the fallback text goes back up while the new one loads.
   */
  useEffect(() => {
    if (!frameLoaded) return;
    let timer = 0;
    const verify = () => {
      const win = frameRef.current?.contentWindow;
      if (!win) return;
      frameAliveRef.current = false;
      win.postMessage(STORY_HELLO_MESSAGE, '*');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (frameAliveRef.current) return;
        setFrameNonce((n) => n + 1);
        setFrameLoaded(false);
      }, FRAME_LIVENESS_GRACE_MS);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') verify(); };
    document.addEventListener('visibilitychange', onVisible);
    // A bfcache restore is the same question through a different event: the
    // page comes back whole, but nothing promises the frame's process did.
    window.addEventListener('pageshow', verify);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', verify);
    };
  }, [frameLoaded]);

  /*
   * The signed export key is the EXPORTER's fingerprint: it is the only caller
   * that loads this page with `?key=` (lib/export-key.ts), and it screenshots
   * the document frame — so that frame comes without its own navigation
   * chrome, and must carry the key onward.
   *
   * It arrives as a PROP, from the server that already parsed the query. Read
   * from `window` instead, it was necessarily null during SSR, so the frame's
   * src was rendered unkeyed and the browser began loading THAT — one request,
   * made before hydration could correct it. For a private document that
   * request is a 404, and the export then photographed a transparent frame
   * over the page's ground: a blank card that looked like a successful shot.
   */
  const captureRender = !!captureKey;

  // `#edit` is the only URL state: readable on load (dashboard deep-links), and
  // kept in sync without a navigation so the shared link never changes. This
  // listener is also what makes browser BACK/FORWARD work — a same-document
  // history move only changes the fragment, so hashchange is the signal.
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === '#edit') { setEditing(true); return; }
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
  }, []);

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
    history.pushState(null, '', '#edit');
    pushedEdit.current = true;
    setEditing(true);
  }, []);
  const enterEdit = useCallback(() => beginEdit(null), [beginEdit]);

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
      history.pushState(null, '', location.pathname);
      setEditing(false);
    }
  }, []);

  // A capability-gated selection bubble inside the opaque frame asks the page
  // to enter a mode. The nonce makes this a runtime request, not author code.
  useEffect(() => {
    const onSelectionAction = (event: MessageEvent) => {
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow || !sessionNonce) return;
      if (!isEditFrameMessage(event.data, sessionNonce) || event.data.type !== STORY_SELECTION_ACTION_MESSAGE) return;
      /*
       * Re-checked against the SAME rule that granted the bubble, the view-mode
       * half included. Withdrawing the capability does not unsend a click that
       * was already in flight, and an `annotate` landing after `#edit` opened
       * would push the other mode's hash while the editor stays mounted — the
       * page in both modes at once, with the editor's drain contract skipped.
       */
      if (!selectionActionCapabilities(canEdit, canAnnotate, !editing)[event.data.action]) return;
      if (event.data.action === 'edit') {
        beginEdit(event.data.selection.path);
        return;
      }
      // Commenting opens a composer on those words. No hash, no mode, nothing
      // for the other mode's exit contract to be skipped by.
      setInitialAnnotationSelection(event.data.selection);
    };
    window.addEventListener('message', onSelectionAction);
    return () => window.removeEventListener('message', onSelectionAction);
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

  /** Everything about THIS document lives behind one control. Navigation is
   * separate on the left; appearance, discussion, editing and owner handoff
   * are grouped here and capability-gated exactly as their old buttons were.
   *
   * There is no longer a "does this viewer have any document action at all"
   * question either — `fork` is offered to everyone this page is served to, on
   * every format, so the sheet always has contents and the old
   * `hasDocumentControls` gate went with the answer it used to compute. */
  const documentControls = (close: () => void) => (
    <div className="space-y-4">
      {/* UNCONDITIONAL, and `fork` is why. Every other row here is capability
          chrome — edit needs write, comments need annotate, both need a markup
          document — but forking needs only the right to READ, which is exactly
          what everyone holding this page already has (the door decides on the
          read ACL, not on ownership). So the guards moved down onto the rows
          that still need them, and a DATASET gets an Artifact section for the
          first time. */}
      <section aria-label="Document actions">
        <h2 className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Artifact</h2>
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
        {/* Everyone the shell is served to — owner, editor, commenter — may
            take a copy of what they can read. */}
        <ForkArtifact id={id} variant="menu" />
        {/* UNCONDITIONAL, for the fork row's reason: the count is public and
            the door decides on the read ACL, not on ownership. An anonymous
            reader gets the number and a way to sign in. */}
        <LikeButton artifactId={id} liked={like.liked} count={like.count} signedIn={accountSession} />
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
              onClick={() => { close(); enterEdit(); }}
              className={CONTROL_ROW}
            >
              <Pencil size={14} strokeWidth={1.75} />
              edit artifact
            </button>
            {/* The social frame is a crop of a DOCUMENT's own picture; a
                folder's card is a picture of its listing, which nobody frames. */}
            {shownSource !== null && format === 'markup' && (
              <button
                type="button"
                aria-label="Edit social preview"
                onClick={() => { close(); setSocialPreviewOpen(true); }}
                className={CONTROL_ROW}
              >
                <Crop size={14} strokeWidth={1.75} />
                social preview
              </button>
            )}
          </>
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
      </section>

      {owner && (
        <section aria-label="Owner actions">
          <h2 className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">owner</h2>
          <CopyAgentPrompt id={id} variant="menu" />
          {/* Owner chrome, unlike the fork row above: a refresh re-fetches
              bytes that every reader of every document naming those URLs is
              then served. Only for a markup document — it is the only format
              that can name an external url at all. */}
          {format === 'markup' && <RefreshAssets id={id} variant="menu" />}
          {format === 'dataset' && (
            <button
              type="button"
              aria-label="Copy dataset reference"
              onClick={() => { void navigator.clipboard?.writeText(`ref:${id}`); setCopiedRef(true); }}
              className={`${CONTROL_ROW} text-accent`}
            >
              {copiedRef ? 'copied dataset reference' : `copy ref:${id}`}
            </button>
          )}
          <ShareLink artifactId={id} owner format={format} variant="menu" className="" />
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
        {editing ? (
          <PageMenu authed={accountSession} anon={anonSession} title={shownTitle} fixed toolbar />
        ) : (
          <PageChromeBar>
            <PageMenu authed={accountSession} anon={anonSession} title={shownTitle} fixed />
            <PageControls
              fixed
              rightOffset={railOpen && !phone ? RIGHT_RAIL_W + 12 : 12}
              label="Artifact controls"
              mode={readerMode}
              onModeChange={setReaderMode}
              active={railOpen}
              badge={openAnnotationCount}
            >
              {documentControls}
            </PageControls>
          </PageChromeBar>
        )}
        <div
          aria-label="Artifact viewport"
          className="fixed inset-x-0 bottom-0 overflow-hidden"
          /*
           * The ground a loading frame sits on. It belongs to the DOCUMENT, not
           * to the app: painting the app's ground (or white, which is what the
           * revealed frame used to carry) flashes the wrong colour under every
           * dark document before its own background arrives. The frame paints
           * over this the moment it says it has.
           */
          /*
           * Editing adds one contextual bar, so the viewport starts lower.
           * A style change, deliberately — the frame stays exactly where it is
           * in the tree, and an iframe that is re-parented RELOADS, which is
           * the entire thing this rewrite exists to stop.
           */
          style={{
            // Two INDEPENDENT reservations, which is what having two axes
            // instead of one mode buys: the editing bar adds height, an open
            // rail takes width, and either can be true without the other.
            // With the rail closed the document stays full-width and its
            // comments float over it. Style-only: the frame must never
            // re-parent.
            top: editing ? EDIT_BAR_H : 0,
            // On a phone the rail is a bottom SHEET (AnnotationLayer), so the
            // document keeps its full width.
            right: railOpen && !phone ? RIGHT_RAIL_W : 0,
            background: readerMode === 'dark' ? DOCUMENT_GROUND.dark : DOCUMENT_GROUND.light,
          }}
        >
          {/* On the document's ground, in a colour that reads on either mode:
              the page has none of the document's tokens, and the app's own
              faint ink is tuned for the app's ground, not this one. */}
          {!frameLoaded && (
            <div
              aria-label="Loading document"
              className="absolute inset-0 flex items-center justify-center font-mono text-xs"
              style={{ color: '#8b8b90' }}
            >
              loading…
            </div>
          )}
          <iframe
            /*
             * NOT keyed on the document: a live edit is posted INTO this frame
             * (above), and re-keying here is what made every agent write a full
             * reload. The nonce is the deliberate replacement — a frame whose
             * process was reclaimed, or one that could not adopt an update.
             */
            key={`${id}:${frameNonce}`}
            ref={frameRef}
            title="artifact"
            // The frame's request is its OWN, and carries neither the page's
            // session nor its query — so a capture has to hand the key down
            // explicitly, or a private document photographs its own 404.
            /*
             * The WRITER's copy carries the runtime even when the document
             * would not otherwise hydrate (?edit=1): editing happens INSIDE
             * this frame, and a prose document ships no runtime to do it with.
             * A COMMENTER needs it for the same reason — the annotate chunk is
             * the runtime's, so pins and tints on a prose document depend on
             * it. Asked for at load, so pressing edit is one message rather
             * than a reload — and a reader's copy is untouched.
             */
            src={`/a/${id}/raw${appendSelection(
              captureRender ? `?chrome=0&key=${encodeURIComponent(captureKey!)}`
              // An EDITOR needs the runtime: editing happens inside this frame
              // and a prose document ships none. A COMMENTER needs only the
              // frame half of annotating — 13 KB against 384 KB — so they ask
              // for that instead. Both are asked for at LOAD, so pressing the
              // control is one message rather than a reload; a reader's copy
              // is untouched by either.
              : canEdit ? '?edit=1'
              : canAnnotate ? '?comment=1'
              : '',
              frameSearch,
            )}`}
            // Belt: a document that somehow never posts still gets revealed.
            onLoad={() => setFrameLoaded(true)}
            // The attribute mirrors the /raw response header's sandbox
            // directive — both apply (intersection), so they must stay the
            // same set. The extra flags let outbound links and popups leave
            // the frame; `allow` is what lets a deck present from inside it.
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
            allow="fullscreen"
            className={`absolute inset-0 block h-full w-full border-0 transition-opacity ${
              frameLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </div>
        {/* Annotations are chrome too: pins live IN the frame, markers and
            threads on the page (which holds the content and the session).
            Mounted in EVERY mode — the `!editing` gate that used to be here is
            exactly what made commenting mid-edit a four-navigation detour. */}
        {canAnnotate && (
          <AnnotationLayer
            id={id}
            frameRef={frameRef}
            sessionNonce={sessionNonce}
            railOpen={railOpen}
            currentEditId={live?.editId ?? editId}
            liveAnnotations={liveAnnotations}
            showViewComments={showViewComments}
            onRailOpenChange={setRailOpen}
            initialSelection={initialAnnotationSelection}
            topOffset={editing ? EDIT_BAR_H : 0}
            beforeCreate={drainEditor}
          />
        )}
        {/* Edit mode is CHROME around the document, not a replacement for it. */}
        {editing && (
          <ArtifactEditor
            id={id}
            seed={editorSeed}
            onExit={finishEdit}
            flushRef={editorFlush}
            frameRef={frameRef}
            sessionNonce={sessionNonce}
            initialSelectionPath={initialEditSelectionPath}
            onComment={canEdit ? commentOnSelection : undefined}
            onToggleComments={canAnnotate ? () => setRailOpen((open) => !open) : undefined}
            commentsOpen={railOpen}
            commentCount={openAnnotationCount}
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
      </>
    );
  }

  // The data tiers are VALUES, not documents: they read as a table, a recipe
  // or an image inside the app's own measure.
  return (
    <>
      <PageChromeBar>
        <PageMenu authed={accountSession} anon={anonSession} title={shownTitle} fixed />
        <PageControls fixed label="Artifact controls">
          {documentControls}
        </PageControls>
      </PageChromeBar>
      <main className="mx-auto w-full max-w-5xl px-4 pt-16 pb-6">
      {format === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element -- the artifact IS the image; no optimizer.
        <img key={rawKey} src={`/a/${id}/raw`} alt={shownTitle} className="mt-4 max-w-full rounded-[6px] border border-edge" />
      )}

      {format === 'pdf' && (
        // A PDF is a FILE, not something the app renders: the browser's own
        // viewer does that, at /raw, which is served inline and sandboxed. So
        // this view is the two facts a person picks a file by and the link that
        // opens it — the same card <File> draws inside a document.
        <div className="mt-4 rounded-[6px] border border-edge bg-surface p-4">
          <p className="font-sans text-xs text-muted" aria-label="PDF summary">
            PDF{fileBytes ? ` · ${formatFileSize(fileBytes)}` : ''}{filePages ? ` · ${filePages} page${filePages === 1 ? '' : 's'}` : ''}
          </p>
          <a
            aria-label="Open the PDF"
            href={`/a/${id}/raw`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block font-sans text-sm underline underline-offset-2"
          >
            Open {shownTitle}
          </a>
        </div>
      )}

      {format === 'dataset' && (
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
