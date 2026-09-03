'use client';

/**
 * EDITING, IN THE DOCUMENT THE READER IS ALREADY LOOKING AT.
 *
 * There is no editor canvas. The document — the served, sandboxed frame the
 * page mounted when it loaded — becomes editable where it stands, and this
 * component is the chrome around it plus the half of the protocol that holds
 * truth: the source, the compile, the flush, the history.
 *
 * What that buys is the whole point of the rewrite. Pressing edit does not
 * unmount a frame, build a second document, boot a second React root, re-run
 * the dataflow and re-mount every chart; it posts one message. The scroll
 * position is not restored because nothing moved it. Nothing flashes because
 * nothing was replaced.
 *
 * Division of labour:
 *   frame  (lib/story-runtime/edit/session) — makes hosts editable, says what
 *          is selected, stages what was typed, applies a format instantly.
 *   here   — composes every edit into the source, persists through the same
 *          save-less protocol as before, and pushes structural changes back
 *          down as `mx:document`, which the runtime re-renders in place.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from '@/lib/dynamic';
import { Check, Code, History, Image as ImageIcon, MessageSquare, Paintbrush } from 'lucide-react';

import ThemePicker, { ModeChip, TemplateChip } from '@/components/ThemePicker';
import { Tooltip } from '@/components/Tooltip';
import { EDIT_BAR_H, RIGHT_RAIL_W } from '@/lib/story/edit-bar';
import VersionHistory from '@/components/VersionHistory';
import VizEditorPanel from '@/components/views/story/VizEditorPanel';
import NumberEditorPanel from '@/components/views/story/NumberEditorPanel';
import StoryFormatToolbar from '@/components/views/story/StoryFormatToolbar';
import { useLiveEdits, type EditorFlushRef } from '@/lib/story/use-live-edits';
import { useLiveArtifact } from '@/lib/story/use-live-artifact';
import { useInPlaceEdit } from '@/lib/story/use-in-place-edit';
import { useArtifactVersions, type ArtifactVersionSnapshot } from '@/lib/story/use-versions';
import { storyUpdateParts } from '@/lib/story/update-parts';
import { isWebUrl } from '@/lib/story/asset-url';
import { imageRawUrl, type RefDataMap } from '@/lib/story/ref-data';
import { bodyPathToSourcePath } from '@/lib/story/edit-compose';
import { insertImageInJsx, removeJsxNodeAtPath } from '@/lib/data/story/jsx-edit';
import { readQuestionChart, updateQuestionChartInJsx, updateQuestionTitleInJsx, type VizEnvelopeValue } from '@/lib/data/story/story-viz';
import { readNumberEmbed, updateNumberEmbedInJsx, type NumberEmbedEdit } from '@/lib/data/story/story-number';
import { updateSlideTitleInJsx } from '@/lib/data/story/story-slides';
import { tableChoices } from '@/lib/story/table-catalog';
import { storyThemeDefaultMode } from '@/lib/data/story/story-themes';
import type { DataflowState } from '@/lib/story/dataflow';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import type { StoryEditSelection, StoryIslandDataflow } from '@/lib/story-runtime/contract';

/**
 * WHICH EXTERNAL URLs THE SERVER HOLDS, from the editor's side: all of them.
 *
 * The page cannot see the `web_assets` rows, and it does not need to. Every
 * literal URL in a stored document was imported by the write that stored it
 * (the publish door runs on the edit path too), so mapping every web URL to
 * `/assets/<hash>` is right for everything the editor is looking at. The one
 * case it gets wrong is a URL whose import FAILED — which the served document
 * draws as a broken image either way — and the next frame from the server
 * corrects it. Not mapping at all is the worse trade: every external image in
 * the document would vanish the moment a structural edit pushed a tree, because
 * the document's own CSP will not load an off-origin `<img>`.
 */
const HELD_ASSETS = isWebUrl;


// Monaco is multiple megabytes and belongs to `code` mode alone; the module
// behind this import also self-hosts it (components/SourceEditor).
const SourceEditor = dynamic(() => import('@/components/SourceEditor'), { ssr: false });

export interface EditorArtifact {
  id: string;
  version: number;
  /** Head pointer this session bases its edits on. */
  edit_id: string;
  title: string | null;
  theme: string | null;
  template: string | null;
  colorMode: string | null;
  /** The stored stylesheet, so the canvas is styled on the FIRST frame. */
  compiledCss?: string | null;
  markup?: string | null;
  refs?: Array<{ id: string; kind: string }>;
  /**
   * The document's dataflow as the page rendered it (server-run) — the canvas
   * shows charts over these tables from the first frame. Null when the
   * document declares nothing.
   */
  dataflow?: StoryIslandDataflow | null;
}



/**
 * The ref entry a just-created image needs. `rawUrl` comes from the create
 * echo (lib/story/ref-data owns the shape); the fallback covers a deployment
 * answering an older echo — a fresh image is always version 1.
 */
const refDataFor = (created: { id: string; rawUrl?: string }): { refData: RefDataMap } => ({
  refData: { [created.id]: { kind: 'image', url: created.rawUrl ?? imageRawUrl(created.id, 1) } },
});

export default function InPlaceEditor({
  art, frameRef, sessionNonce, flushRef, initialSelectionPath = null, onComment, onToggleComments, commentsOpen = false, commentCount = 0, onDone = () => {},
}: {
  art: EditorArtifact;
  /** The live document. Never remounted — that is the whole point. */
  frameRef: { current: HTMLIFrameElement | null };
  /** Learned by the page when the document announced itself, long before this mounted. */
  sessionNonce: string | null;
  flushRef?: EditorFlushRef;
  /** A node chosen from the view-mode text-selection bubble. */
  initialSelectionPath?: string | null;
  /**
   * Comment on what is selected — the edit-mode surface for an action the
   * view-mode bubble offers on the same capability. Absent for anyone who may
   * not comment, and then neither the toolbar control nor the shortcut exists.
   */
  onComment?: (selection: StoryEditSelection) => void;
  onToggleComments?: () => void;
  commentsOpen?: boolean;
  commentCount?: number;
  /** Drain-and-exit belongs to the page, because browser back uses the same contract. */
  onDone?: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState(art.title ?? '');
  const [theme, setTheme] = useState<StoryThemeName | null>((art.theme as StoryThemeName) ?? null);
  // Nullable on purpose: null means "no author pick", so the theme's declared
  // default decides (surfaceMode below) — coercing to 'light' here showed a
  // dark-default theme in a mode it would never be read in.
  const [colorMode, setColorMode] = useState<'light' | 'dark' | null>(
    art.colorMode === 'dark' ? 'dark' : art.colorMode === 'light' ? 'light' : null,
  );
  const [source, setSource] = useState(art.markup ?? '');
  const [css, setCss] = useState<string | null>(art.compiledCss ?? null);
  const [mode, setMode] = useState<'design' | 'code'>('design');
  const [dataflowState, setDataflowState] = useState<DataflowState | null>(art.dataflow?.state ?? null);
  const [imageError, setImageError] = useState<string | null>(null);
  const selectionRef = useRef<StoryEditSelection | null>(null);
  /*
   * ⌘⌥M — the shortcut Docs taught everyone's fingers. It reads the SAME
   * selection the toolbar's button does, so there is one path into the
   * composer and no way for the two to disagree about what is being commented
   * on. Bound on the page (not in the frame) because the page is where the
   * composer lives; the frame's own keydowns bubble here through the runtime's
   * edit session, and a caret in a text host still gets its keystroke first.
   */
  useEffect(() => {
    if (!onComment) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'm' || !event.altKey || !(event.metaKey || event.ctrlKey)) return;
      const current = selectionRef.current;
      if (!current) return;
      event.preventDefault();
      onComment(current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onComment]);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** An older version, shown in the document itself. Read-only while it is up. */
  const [preview, setPreview] = useState<ArtifactVersionSnapshot | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  /** Read by callbacks that run after an await, when `source` may have moved on. */
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const cssRef = useRef(css);
  cssRef.current = css;
  const dataflowRef = useRef(dataflowState);
  dataflowRef.current = dataflowState;
  // Same resolution as the served document (lib/story/document.ts): the author's
  // colorMode decides, the theme's declared default is the fallback. Editing a
  // document must not show it in a mode it will never be read in.
  const surfaceMode = colorMode ?? storyThemeDefaultMode(theme) ?? 'light';
  const colorModeRef = useRef(surfaceMode);
  colorModeRef.current = surfaceMode;
  /** The declarations the document was last told about — see showInDocument. */
  const pushedDeclarations = useRef<string | null>(storyUpdateParts(art.markup ?? '')?.declarations ?? null);

  // ── the document's own copy ───────────────────────────────────────────────
  /**
   * Show a version of the document in the frame WITHOUT replacing it.
   *
   * The runtime ships no JSX parser, so the nodes are made here — through the
   * same door the served document and the live stream use, so a pushed version
   * can never describe a different tree than a reload of the same source would.
   */
  const showInDocument = useCallback((next: string, over?: { compiledCss?: string | null; colorMode?: 'light' | 'dark'; refData?: RefDataMap }) => {
    const parts = storyUpdateParts(next, HELD_ASSETS);
    if (!parts) return;   // mid-keystroke source that does not parse yet
    const declarationsChanged = parts.declarations !== pushedDeclarations.current;
    frameRef.current?.contentWindow?.postMessage({
      type: 'mx:document',
      nodes: parts.nodes,
      ...(parts.authorCss !== null ? { authorCss: parts.authorCss } : {}),
      /*
       * Absent means "unchanged"; NULL means "this document has no stylesheet".
       * Sending null because we happen not to hold one yet strips the sheet
       * off a styled document — it collapses to unstyled text, and the reader's
       * scroll position collapses with it.
       */
      ...(typeof (over?.compiledCss ?? cssRef.current) === 'string'
        ? { compiledCss: over?.compiledCss ?? cssRef.current }
        : {}),
      colorMode: over?.colorMode ?? colorModeRef.current,
      // Refs the served document could not know: an image inserted just now is
      // a brand-new artifact, and without its entry the interpreter renders
      // the literal `ref:<id>` into src — a broken image until a full reload.
      ...(over?.refData ? { refData: over.refData } : {}),
      /*
       * DATA ONLY WHEN THE DECLARATIONS CHANGED — the live stream's own rule
       * (app/a/[id]/events), and load-bearing for two separate reasons.
       *
       * Absent means "the data is as you have it": sending a flow with EMPTY
       * state replaces every table the document is showing, so the chart loses
       * its rows and the page collapses under the reader. And sending the SAME
       * data again is not free either — the store re-runs the queries it
       * describes, and the chart is rebuilt to draw the answer. A prose edit
       * must cost neither.
       */
      ...(dataflowRef.current && declarationsChanged
        ? { dataflow: { flow: parts.flow, state: dataflowRef.current } satisfies StoryIslandDataflow }
        : {}),
    }, '*');
    pushedDeclarations.current = parts.declarations;
  }, [frameRef]);

  /** A structural change: source, persistence and the document, in one act. */
  const commitStructural = useCallback((next: string, over?: { refData?: RefDataMap }) => {
    if (next === sourceRef.current) return;   // stale path / no-op — never dirty the document
    setSource(next);
    queueRef.current?.({ source: next });
    showInDocument(next, over);
  }, [showInDocument]);

  // ── persistence (unchanged protocol) ──────────────────────────────────────
  /*
   * The ONE path that replaces the source from outside. The code pane cannot
   * tell that apart from an echo of its own typing by looking at the text (both
   * are just "a different string arrived"), and guessing costs keystrokes — so
   * it is told, and this counter is the telling.
   */
  const [sourceRevision, setSourceRevision] = useState(0);
  const onRemoteDocument = useCallback((next: string) => {
    setSource(next);
    setSourceRevision((n) => n + 1);
    showInDocument(next);
  }, [showInDocument]);

  const editRef = useRef<ReturnType<typeof useInPlaceEdit> | null>(null);
  const isUserEditing = useCallback(() => editRef.current?.isUserEditing() ?? false, []);

  const { state: live, queue, flushNow, adoptRemote, isOwnEdit } = useLiveEdits({
    id: art.id,
    initialEditId: art.edit_id,
    initialVersion: art.version,
    onRemoteDocument,
    isUserEditing,
  });
  const queueRef = useRef(queue);
  queueRef.current = queue;

  // insertImage is defined below (it needs commitStructural); the paste/drop
  // door reaches it through this ref so all three insert doors stay ONE path.
  const insertImageRef = useRef<((file: File) => void) | null>(null);
  const edit = useInPlaceEdit({
    frameRef,
    sessionNonce,
    onImageDrop: useCallback((file: File) => { insertImageRef.current?.(file); }, []),
    editing: mode === 'design' && !preview,
    sourceRef,
    onSourceEdited: useCallback((next: string) => {
      // A text or format edit the DOCUMENT already shows: persist it, but do
      // not push it back — the frame's DOM is ahead of us and re-rendering
      // would take the caret with it.
      setSource(next);
      queueRef.current?.({ source: next });
    }, []),
    onSlideTitle: useCallback((path: string, title: string) => {
      commitStructural(updateSlideTitleInJsx(sourceRef.current, bodyPathToSourcePath(sourceRef.current, path), title));
    }, [commitStructural]),
    onEditKey: useCallback((key: 'Delete' | 'Backspace' | 'Escape', selection: StoryEditSelection | null) => {
      if (key === 'Escape') { edit?.select(null); return; }
      if (!selection) return;
      commitStructural(removeJsxNodeAtPath(sourceRef.current, bodyPathToSourcePath(sourceRef.current, selection.path)));
    }, [commitStructural]),  // eslint-disable-line react-hooks/exhaustive-deps
  });
  editRef.current = edit;

  // The edit chunk announces readiness after its listeners exist. Only then
  // restore the node the reader selected in view mode; an earlier mx:select
  // would disappear into a document that was not editing yet.
  useEffect(() => {
    if (edit.ready && initialSelectionPath) edit.select(initialSelectionPath);
  }, [edit.ready, edit.select, initialSelectionPath]);

  // Changes from elsewhere (an agent, another person) while we are editing.
  const remote = useLiveArtifact(art.id, art.edit_id, art.version, true, isOwnEdit);
  useEffect(() => {
    if (!remote || remote.format !== 'markup' || typeof remote.source !== 'string') return;
    if (!adoptRemote(remote.editId, remote.source, remote.by)) return;
    /*
     * The document under the inspector is not the one it opened on. AST paths
     * are POSITIONAL, so a node inserted before the selected chart shifts it
     * and the panel would go on editing whatever now sits at that path —
     * plausibly a different <Question>, which no tag guard downstream would
     * question. Only an ADOPTED write does this: our own echo returns down the
     * same stream, and closing on that would shut the inspector every time the
     * user changed something in it.
     */
    editRef.current?.select(null);
    if (remote.compiledCss !== undefined) setCss(remote.compiledCss);
  }, [remote, adoptRemote]);

  // ── draft compile ─────────────────────────────────────────────────────────
  const cssCache = useRef(new Map<string, string>());
  const compileTimer = useRef(0);
  const lastCompiled = useRef<string | null>(art.compiledCss ? (art.markup ?? '') : null);
  useEffect(() => {
    const key = source;
    if (lastCompiled.current === key) return;
    const cached = cssCache.current.get(key);
    if (cached !== undefined) { setCss(cached); showInDocument(key, { compiledCss: cached }); return; }
    const run = async () => {
      const res = await fetch('/api/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markup: key }),
      }).catch(() => null);
      if (!res?.ok) return;
      const body = (await res.json()) as { css?: string | null };
      if (typeof body.css !== 'string') return;
      lastCompiled.current = key;
      cssCache.current.set(key, body.css);
      if (cssCache.current.size > 20) {
        const first = cssCache.current.keys().next().value;
        if (first !== undefined) cssCache.current.delete(first);
      }
      setCss(body.css);
      // New utilities need to reach the document that is already showing them.
      if (sourceRef.current === key) showInDocument(key, { compiledCss: body.css });
    };
    window.clearTimeout(compileTimer.current);
    compileTimer.current = window.setTimeout(() => { void run(); }, 300);
    return () => window.clearTimeout(compileTimer.current);
  }, [source, showInDocument]);

  // ── draft data ────────────────────────────────────────────────────────────
  /** Keyed on the DECLARATIONS: a prose edit re-runs nothing. */
  const flowSignature = useMemo(() => storyUpdateParts(source)?.declarations ?? null, [source]);
  /*
   * What was already run FOR us — so a draft whose declarations have not moved
   * re-runs nothing. The test is `state`, not the dataflow itself: paint-first
   * sends the declarations without the rows, and a document that merely
   * DECLARES data has had none of it run. Keying on the dataflow left the
   * chart panel offering columns nobody had fetched.
   */
  const ranSignature = useRef<string | null>(art.dataflow?.state ? flowSignature : null);
  useEffect(() => {
    if (flowSignature === null || flowSignature === ranSignature.current) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      ranSignature.current = flowSignature;
      void fetch('/api/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markup: sourceRef.current }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { tables: DataflowState['tables']; errors: DataflowState['errors'] } | null) => {
          if (!alive || !body) return;
          const next = { values: {}, tables: body.tables, errors: body.errors };
          setDataflowState(next);
          dataflowRef.current = next;
          showInDocument(sourceRef.current);
        })
        .catch(() => {});
    }, 400);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [flowSignature, showInDocument]);

  // ── leaving ───────────────────────────────────────────────────────────────
  /**
   * Leaving collects what the document is still holding FIRST.
   *
   * The document commits a text edit on blur, so the last thing typed exists
   * only in its DOM until somebody asks. Draining before asking drains an
   * empty buffer and loses exactly the edit the reader made last.
   */
  const leave = useCallback(async () => {
    await editRef.current?.commitPending();
    await flushNow();
  }, [flushNow]);

  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => leave();
    return () => { flushRef.current = null; };
  }, [flushRef, leave]);

  /** A hiding tab may never come back. */
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void leave(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [leave]);

  // ── embeds ────────────────────────────────────────────────────────────────
  const selection = edit.selection;
  // Read by the ⌘⌥M listener, which is bound once and must not re-subscribe on
  // every caret move.
  selectionRef.current = selection;
  /*
   * A path the DOCUMENT reported indexes the BODY; the source it is read from
   * still begins with the <Helmet>. Translated once, here, so everything below
   * works in source coordinates (lib/story/edit-compose).
   */
  const embedPath = selection?.kind === 'embed' ? bodyPathToSourcePath(source, selection.path) : null;
  const chart = embedPath && selection?.tag === 'Question' ? readQuestionChart(source, embedPath) : null;
  const numberEmbed = embedPath && selection?.tag === 'Number' ? readNumberEmbed(source, embedPath) : null;
  const tables = useMemo(() => tableChoices(source, dataflowState), [source, dataflowState]);

  const onChartChange = useCallback((next: { viz: unknown; table: string | null }) => {
    if (!embedPath) return;
    commitStructural(updateQuestionChartInJsx(sourceRef.current, embedPath, {
      viz: next.viz as VizEnvelopeValue | undefined, table: next.table,
    }));
  }, [embedPath, commitStructural]);

  const onChartTitleChange = useCallback((next: string | null) => {
    if (!embedPath) return;
    commitStructural(updateQuestionTitleInJsx(sourceRef.current, embedPath, next));
  }, [embedPath, commitStructural]);

  const onNumberChange = useCallback((next: NumberEmbedEdit) => {
    if (!embedPath) return;
    commitStructural(updateNumberEmbedInJsx(sourceRef.current, embedPath, next));
  }, [embedPath, commitStructural]);

  const deleteSelected = useCallback(() => {
    if (!selection) return;
    commitStructural(removeJsxNodeAtPath(sourceRef.current, bodyPathToSourcePath(sourceRef.current, selection.path)));
    edit.select(null);
  }, [selection, commitStructural, edit]);

  // ── images ────────────────────────────────────────────────────────────────
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const [imageUrlDraft, setImageUrlDraft] = useState('');
  /**
   * The URL half of insert-image: the browser door ingests-and-owns it
   * (POST {imageUrl} — the same lib/web-ingest path the agent door runs), and
   * the source gets `ref:<id>` exactly like an upload. The door's refusal is
   * SHOWN verbatim-ish: it names the URL and the reason, which is the point.
   */
  const insertImageFromUrl = useCallback(async () => {
    const url = imageUrlDraft.trim();
    if (!url) return;
    setImageError(null);
    const res = await fetch('/api/my/artifacts?visibility=unlisted', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: url }),
    }).catch(() => null);
    if (!res) { setImageError('Import failed — check your connection and try again.'); return; }
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string; details?: string[] } | null;
      setImageError(
        body?.details?.[0]
        ?? (res.status === 403 ? 'You have reached your artifact limit.' : 'Could not import that image.'),
      );
      return;
    }
    const created = (await res.json()) as { id: string; rawUrl?: string };
    commitStructural(insertImageInJsx(sourceRef.current, created.id), refDataFor(created));
    setImageUrlDraft('');
    setImageMenuOpen(false);
  }, [imageUrlDraft, commitStructural]);

  const insertImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setImageError(null);
    const res = await fetch('/api/my/artifacts?visibility=unlisted', {
      method: 'POST', headers: { 'Content-Type': file.type }, body: file,
    }).catch(() => null);
    if (!res) { setImageError('Upload failed — check your connection and try again.'); return; }
    if (!res.ok) {
      const code = await res.json().then((b) => b?.error).catch(() => null);
      setImageError(
        res.status === 413 ? 'That image is too large to upload.'
        : res.status === 403 ? 'You have reached your artifact limit.'
        : code === 'invalid_image' ? 'That image type is not supported (png, jpeg, webp, gif, svg).'
        : 'Could not upload that image.',
      );
      return;
    }
    const created = (await res.json()) as { id: string; rawUrl?: string };
    commitStructural(insertImageInJsx(sourceRef.current, created.id), refDataFor(created));
  }, [commitStructural]);
  insertImageRef.current = insertImage;

  // ── version history ───────────────────────────────────────────────────────
  const history = useArtifactVersions({ id: art.id, currentVersion: live.version });

  /**
   * Looking at an older version shows it IN the document — same frame, same
   * engine that renders the real thing. Editing is off while it is up: this
   * editor has no save button, so typing into an old version would quietly
   * publish it.
   */
  const previewVersion = useCallback(async (v: number) => {
    const snapshot = await history.fetchVersion(v);
    if (!snapshot) return;
    setPreview(snapshot);
    edit.select(null);
    showInDocument(snapshot.markup ?? '', {
      compiledCss: snapshot.meta.compiledCss ?? cssRef.current,
      colorMode: snapshot.meta.colorMode ?? colorModeRef.current,
    });
  }, [history, showInDocument, edit]);

  const backToCurrent = useCallback(() => {
    setPreview(null);
    showInDocument(sourceRef.current);
  }, [showInDocument]);

  const restoreVersion = useCallback(async (v: number) => {
    const next = await history.restore(v);
    if (next === null) return;
    // The restored state IS the document now; the live stream delivers it on
    // the same path an agent's edit arrives on.
    setPreview(null);
    setHistoryOpen(false);
    await history.refresh();
  }, [history]);

  return (
    <>
      <header
        aria-label="Editor toolbar"
        className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-edge bg-surface/95 pr-2 pl-14 backdrop-blur"
        style={{ height: EDIT_BAR_H }}
      >
        {/* The DOCUMENT's controls scroll; the ACTIONS never do. On a phone the
            bar's natural width is ~434px against a 390px viewport, and it was
            the actions that fell off the end — `done`, the way out of edit
            mode, sat 17px on-screen. Hiding controls at that width would have
            been the smaller change and the wrong one: the title, the theme and
            the mode are what someone edits on a phone FOR. Guarded by the
            editor leg of scripts/gate-mobile.mjs. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        <input
          aria-label="Title"
          value={title}
          onChange={(e) => { setTitle(e.target.value); queue({ title: e.target.value }); }}
          placeholder="untitled"
          className="w-36 shrink-0 rounded-[4px] border border-transparent bg-transparent px-1.5 py-1 font-mono text-xs font-semibold text-fg hover:border-edge focus:border-edge-bright focus:outline-none sm:w-48"
        />
        <ThemePicker
          value={theme}
          colorMode={colorMode}
          onPick={(t) => {
            setTheme(t);
            queue({ theme: t });
            // The document carries its own design attributes; tell it directly
            // rather than making it wait for the save to come back around. With
            // no author pick the MODE follows the new theme's declared default.
            frameRef.current?.contentWindow?.postMessage({ type: 'mx:document', nodes: storyUpdateParts(sourceRef.current, HELD_ASSETS)?.nodes ?? [], theme: t, colorMode: colorMode ?? storyThemeDefaultMode(t) ?? 'light' }, '*');
          }}
        />
        <TemplateChip template={art.template} />
        {/* The AUTHOR'S DEFAULT mode, beside the theme it composes with. Every
            theme carries both palettes, so this is meaningful for every
            document; "theme default" stores an explicit null so the mode
            follows a later theme switch. Readers can still flip their own view. */}
        <ModeChip
          mode={colorMode}
          themeDefault={storyThemeDefaultMode(theme) ?? 'light'}
          onPick={(next) => {
            setColorMode(next);
            const effective = next ?? storyThemeDefaultMode(theme) ?? 'light';
            colorModeRef.current = effective;
            queue({ colorMode: next });
            showInDocument(sourceRef.current, { colorMode: effective });
          }}
        />

        </div>

        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            aria-label="Upload image file"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void insertImage(f); e.target.value = ''; }}
          />
          <div className="relative">
            <Tooltip content="insert image">
              <button
                type="button"
                aria-label="Insert image"
                aria-expanded={imageMenuOpen}
                onClick={() => setImageMenuOpen((v) => !v)}
                className="inline-flex h-6 cursor-pointer items-center justify-center rounded-[4px] border border-edge px-2 text-muted hover:border-edge-bright hover:text-fg"
              >
                <ImageIcon size={12} />
              </button>
            </Tooltip>
            {imageMenuOpen && (
              <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-[5px] border border-edge bg-surface p-2 shadow-lg">
                <button
                  type="button"
                  aria-label="Upload image from file"
                  onClick={() => { setImageMenuOpen(false); imageInputRef.current?.click(); }}
                  className="w-full cursor-pointer rounded-[4px] border border-edge px-2 py-1 text-left font-mono text-[11px] text-fg hover:border-edge-bright hover:bg-raised"
                >
                  upload a file…
                </button>
                <div className="mt-2 flex gap-1.5">
                  <input
                    aria-label="Image URL"
                    value={imageUrlDraft}
                    placeholder="or paste an image URL (https://…)"
                    onChange={(e) => setImageUrlDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void insertImageFromUrl(); } }}
                    className="min-w-0 flex-1 rounded-[4px] border border-edge bg-transparent px-1.5 py-1 font-mono text-[11px] text-fg focus:border-edge-bright focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label="Import image from URL"
                    onClick={() => void insertImageFromUrl()}
                    className="cursor-pointer rounded-[4px] border border-edge px-2 py-1 font-mono text-[11px] text-fg hover:border-edge-bright hover:bg-raised"
                  >
                    import
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="flex h-6 items-center overflow-hidden rounded-[4px] border border-edge" role="group" aria-label="View">
            {([['design', 'Edit on the page'], ['code', 'Edit the source']] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                aria-label={label}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`inline-flex h-full cursor-pointer items-center gap-1 px-1.5 font-mono text-[11px] ${
                  mode === m ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg'
                }`}
              >
                {m === 'design' ? <Paintbrush size={12} /> : <Code size={12} />}
                <span className="hidden sm:inline">{m}</span>
              </button>
            ))}
          </div>
          <Tooltip content="version history">
            <button
              type="button"
              aria-live="polite"
              aria-label="Open version history"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((v) => !v)}
              className={`inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] border px-1.5 font-mono text-[11px] ${
                historyOpen ? 'border-accent/40 bg-accent-soft text-accent' : 'border-edge text-muted hover:border-edge-bright hover:text-fg'
              }`}
            >
              <History size={12} className="shrink-0" />
              <span className="hidden sm:inline">
                {live.status || (live.pending ? 'saving…' : `v${live.version} · saved`)}
              </span>
            </button>
          </Tooltip>
          {onToggleComments && (
            <Tooltip content={commentsOpen ? 'close comments' : 'comments'}>
              <button
                type="button"
                aria-label="Toggle comments"
                aria-pressed={commentsOpen}
                onClick={onToggleComments}
                className={`relative inline-flex h-7 cursor-pointer items-center justify-center rounded-[4px] border px-2 ${commentsOpen ? 'border-accent/40 bg-accent-soft text-accent' : 'border-edge text-muted hover:text-fg'}`}
              >
                <MessageSquare size={13} />
                {commentCount > 0 && <span className="ml-1 font-mono text-[10px]">{commentCount}</span>}
              </button>
            </Tooltip>
          )}
          <Tooltip content="done editing">
            <button
              type="button"
              aria-label="Exit edit mode"
              onClick={() => void onDone()}
              className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[4px] border border-accent/40 bg-accent-soft px-2 font-mono text-[11px] text-accent hover:border-accent"
            >
              <Check size={13} />
              <span className="hidden sm:inline">done</span>
            </button>
          </Tooltip>
        </div>
      </header>

      {imageError && (
        <div
          aria-label="Image upload error"
          className="fixed inset-x-0 z-30 flex items-center justify-between gap-3 border-b border-red-300 bg-red-50 px-4 py-1.5 font-mono text-[11px] text-red-800"
          style={{ top: EDIT_BAR_H }}
        >
          <span>{imageError}</span>
          <button
            type="button"
            aria-label="Dismiss image error"
            onClick={() => setImageError(null)}
            className="cursor-pointer rounded border border-red-300 px-2 py-0.5 hover:bg-red-100"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Editing the source: an overlay over the document, not a second pane —
          the document IS the preview, and one click away is close enough. */}
      {mode === 'code' && (
        <div
          className="fixed inset-x-0 bottom-0 z-20"
          style={{ top: EDIT_BAR_H }}
          aria-label="Source pane"
        >
          <SourceEditor
            value={source}
            revision={sourceRevision}
            onChange={(text) => {
              setSource(text);
              queue({ source: text });
            }}
          />
        </div>
      )}

      {/* The floating format controls, anchored from the rect the document
          reported — it is a different document, so there is no element here. */}
      {mode === 'design' && (
        <StoryFormatToolbar
          selection={selection}
          frameRef={frameRef}
          compiledCss={css}
          onApply={edit.applyFormat}
          onApplyLink={edit.applyLink}
          onSelect={edit.select}
          onDelete={deleteSelected}
          onComment={onComment}
        />
      )}

      {/* The embed inspector: a fixed panel, since the thing it edits lives in
          another realm and anchoring to it buys only positioning bugs.
          It is the RIGHT RAIL's other occupant — one width for both, because
          they can now be up at the same time (comments no longer leave with the
          mode). It takes the rail while a chart is selected: same width, higher
          layer, so the two read as one column rather than two panels fighting
          for an edge. */}
      {(chart || numberEmbed) && mode === 'design' && (
        <aside
          aria-label={chart ? 'Chart inspector' : 'Number inspector'}
          className="fixed right-0 bottom-0 z-30 overflow-y-auto border-l border-edge bg-surface p-3"
          style={{ top: EDIT_BAR_H, width: RIGHT_RAIL_W }}
        >
          {/* No delete here: the selection toolbar offers it for EVERY
              selection (lib/story/selection-toolbar ALWAYS_OFFERED), and a
              second trash an inch from `close` was the one people hit by
              mistake. The inspector inspects; the toolbar acts on the node. */}
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wide text-faint">{chart ? 'chart' : 'number'}</span>
            <button
              type="button"
              aria-label={chart ? 'Close chart inspector' : 'Close number inspector'}
              onClick={() => edit.select(null)}
              className="cursor-pointer font-mono text-[11px] text-muted hover:text-fg"
            >
              close
            </button>
          </div>
          {chart ? (
            <VizEditorPanel
              viz={chart.viz}
              title={chart.title}
              table={chart.table}
              tables={tables}
              onChange={onChartChange}
              onTitleChange={onChartTitleChange}
            />
          ) : (
            <NumberEditorPanel binding={numberEmbed!} tables={tables} onChange={onNumberChange} />
          )}
        </aside>
      )}

      {historyOpen && (
        <VersionHistory
          versions={history.versions}
          currentVersion={live.version}
          previewing={preview?.version ?? null}
          onPreview={(v: number) => void previewVersion(v)}
          onRestore={(v: number) => void restoreVersion(v)}
          onBackToCurrent={backToCurrent}
          onClose={() => setHistoryOpen(false)}
          busy={history.busy}
        />
      )}
    </>
  );
}
