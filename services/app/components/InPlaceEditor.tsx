'use client';
import type {DocumentGraph} from '@artifactbin/contracts';

import type { EditorSelectionChange } from '@/lib/editor-v2/bookmark';

/**
 * EDITING, IN THE DOCUMENT THE READER IS ALREADY LOOKING AT.
 *
 * The page's mounted InlineStoryRuntime becomes editable in place. This
 * component owns the editing chrome, source composition, persistence and history.
 *
 * Pressing edit does not unmount the runtime, build a second document, boot a
 * second React root, re-run the dataflow and re-mount every chart; it sends a
 * runtime command. The scroll position is not restored because nothing moved
 * it. Nothing flashes because nothing was replaced.
 *
 * Division of labour:
 *   runtime (lib/story-runtime/edit/session) — makes hosts editable, says what
 *          is selected, stages what was typed, applies a format instantly.
 *   here   — composes every edit into the source, persists through the
 *          save-less protocol, and pushes structural changes back down as
 *          `mx:document`, which the runtime re-renders in place.
 * runtimeRef carries commands on the app page; frameRef preserves the standalone
 * framed-document compatibility path through the same endpoint contract.
 */
import { sendDocument, type DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SourceEditor from '@/components/SourceEditorPane';
import { editBlock } from '@/lib/editor-v2/block-edit';
import { SourceHistory } from '@/lib/editor-v2/history';
import { ChartColumn, Check, Code, Database, Hash, History, MessageSquare, Undo2, Redo2, Paintbrush, SlidersHorizontal, Workflow, X } from 'lucide-react';
import { TrustedUi } from '@/components/TrustedUi';

import ThemePicker, { ModeChip, TemplateChip } from '@/components/ThemePicker';
import { Tooltip } from '@/components/Tooltip';
import { APP_BAR_H, EDIT_BAR_H, EDIT_BAR_ROW_H } from '@/lib/story/edit-bar';
import MobileSheet, { useIsPhoneViewport } from '@/components/MobileSheet';
import EditPanel, { SELECTION_HINT, type EditPanelTab } from '@/components/EditPanel';
import { editPanelWidth, readEditPanelCollapsed, useWideEditViewport, writeEditPanelCollapsed } from '@/lib/story/use-edit-panel';
import VersionHistory from '@/components/VersionHistory';
import VizEditorPanel from '@/components/views/story/VizEditorPanel';
import NumberEditorPanel from '@/components/views/story/NumberEditorPanel';
import MermaidEditorPanel from '@/components/views/story/MermaidEditorPanel';
import QueryNotebookPanel from '@/components/views/story/QueryNotebookPanel';
import { StoryToolbarMenu } from '@/components/views/story/StoryToolbarMenu';
import StoryFormatToolbar from '@/components/views/story/StoryFormatToolbar';
import MarkdownPasteDialog from '@/components/views/story/MarkdownPasteDialog';
import { useLiveEdits, type EditorFlushRef } from '@/lib/story/use-live-edits';
import { useNavigationGuard } from '@/web/NavigationBoundary';
import { useLiveArtifact } from '@/lib/story/use-live-artifact';
import { useInPlaceEdit } from '@/lib/story/use-in-place-edit';
import { useArtifactVersions, type ArtifactVersionSnapshot } from '@/lib/story/use-versions';
import { storyUpdateParts } from '@/lib/story/update-parts';
import { isWebUrl } from '@/lib/story/asset-url';
import { imageRawUrl, type RefDataMap } from '@/lib/story/ref-data';
import { bodyPathToSourcePath, sourcePathToBodyPath } from '@/lib/story/edit-compose';
import {
  freshNodeId,
  imageAltInJsx,
  imageTargetInJsx,
  nodeTargetInJsx,
  placeImageInJsx,
  removeJsxNodeAtPath,
  replaceImageSrcInJsx,
  setImageAltInJsx,
  type JsxImageTarget,
  type JsxInsertAnchor,
} from '@/lib/data/story/jsx-edit';
import ImageDialog, { IMAGE_ACCEPT, type ChosenImage, type ImageChoice } from '@/components/views/story/ImageDialog';
import { useArtifactBackend } from '@/lib/artifact-backend/context';
import { FeatureGate } from '@/components/FeatureUnavailable';
import type { ImageDropPlacement } from '@/lib/story/use-in-place-edit';
import {
  readQuestionChart,
  updateQuestionChartInJsx,
  updateQuestionTitleInJsx,
  type VizEnvelopeValue,
} from '@/lib/data/story/story-viz';
import { readNumberEmbed, updateNumberEmbedInJsx, type NumberEmbedEdit } from '@/lib/data/story/story-number';
import { readMermaidEmbed, updateMermaidEmbedInJsx, type MermaidEmbedEdit } from '@/lib/data/story/story-mermaid';
import { updateSlideTitleInJsx } from '@/lib/data/story/story-slides';
import { tableChoices } from '@/lib/story/table-catalog';
import { queryCells, updateQuerySqlInJsx } from '@/lib/story/query-notebook';
import { storyThemeDefaultMode } from '@/lib/data/story/story-themes';
import type { DataflowState } from '@/lib/story/dataflow';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import type { StoryEditSelection, StoryIslandDataflow } from '@/lib/story-runtime/contract';

/** The embed inspectors the Selection tab can show, by the selected embed's kind. */
const INSPECTOR_LABEL = { chart: 'Chart inspector', number: 'Number inspector', diagram: 'Diagram inspector' } as const;
/** The toolbar's way to the inspector of what is selected. */
const INSPECT_LABEL = { chart: 'Edit chart', number: 'Edit number', diagram: 'Edit diagram' } as const;
const INSPECT_ICON = { chart: ChartColumn, number: Hash, diagram: Workflow } as const;
/** Two taps this close in time and place are a double-tap (touch emits no reliable dblclick). */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 24;
const narrowTabClass = (active: boolean) =>
  `inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] border px-1.5 font-mono text-[11px] ${
    active ? 'border-accent/40 bg-accent-soft text-accent' : 'border-edge text-muted hover:border-edge-bright hover:text-fg'
  }`;

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

interface EditorArtifact {
  document?:DocumentGraph;
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
  refs?: Array<{ id: string; kind: string; title?: string | null }>;
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
  art,
  frameRef,
  runtimeRef,
  sessionNonce,
  flushRef,
  initialSelectionPath = null,
  onComment,
  rightInset = 0,
  onDone = () => {},
  onRightInsetChange,
  commentsOpen = false,
  onCommentsOpenChange,
  onCommentsHost,
}: {
  art: EditorArtifact;
  /** Optional standalone document frame compatibility ref; the active page uses runtimeRef. */
  frameRef?: { current: HTMLIFrameElement | null };
  runtimeRef?: DocumentRuntimeRef;
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
  /** How far the toolbar stops short of the viewport's right edge: the comments rail plus the document scrollbar. */
  rightInset?: number;
  /** Drain-and-exit belongs to the page, because browser back uses the same contract. */
  onDone?: () => void | Promise<void>;
  /**
   * The width of the edit panel on the right (components/EditPanel): constant
   * for the session except when the viewer collapses or expands it, 0 below
   * the panel breakpoint. The PAGE decides whether that width is reserved.
   */
  onRightInsetChange?: (px: number) => void;
  /** The page's comments rail is open — in edit mode, the panel's Comments tab. */
  commentsOpen?: boolean;
  /** Open or close the comments rail. Absent for anyone who may not comment: no Comments tab. */
  onCommentsOpenChange?: (open: boolean) => void;
  /** The Comments tab's body, for the page's comments rail to render into; null while it is not showing. */
  onCommentsHost?: (host: HTMLElement | null) => void;
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
  /** Every request this editor makes (lib/artifact-backend), from the page's provider. */
  const backend = useArtifactBackend();
  const [css, setCss] = useState<string | null>(art.compiledCss ?? null);
  const [mode, setMode] = useState<'design' | 'code'>('design');
  const [dataflowState, setDataflowState] = useState<DataflowState | null>(art.dataflow?.state ?? null);
  const [imageError, setImageError] = useState<string | null>(null);
  const selectionRef = useRef<StoryEditSelection | null>(null);
  /*
   * ⌘⌥M — the shortcut Docs taught everyone's fingers. It reads the SAME
   * selection the toolbar's button does, so there is one path into the
   * composer and no way for the two to disagree about what is being commented
   * on. Bound on the page (not in the document runtime) because the page is where the
   * composer lives; the document runtime's own keydowns bubble here through the
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
  /** The right rail's query notebook (components/views/story/QueryNotebookPanel). */
  const [queriesOpen, setQueriesOpen] = useState(false);
  /** The cell the notebook lands on when opened FROM an embed's inspector; null once the rail has gone. */
  const [queryFocus, setQueryFocus] = useState<string | null>(null);
  /** True from the moment a draft-data run is sent until its answer lands — the notebook's "running…". */
  const [dataflowPending, setDataflowPending] = useState(false);
  /** An older version, shown in the document itself. Read-only while it is up. */
  const [preview, setPreview] = useState<ArtifactVersionSnapshot | null>(null);
  /*
   * THE PANEL. On a wide window one right panel for the session, its tab and
   * collapse held here; below the breakpoint the same three things open as
   * bottom sheets from the bar (`sheet`), and the comments one is the page's.
   */
  const wide = useWideEditViewport();
  const [panelTab, setPanelTab] = useState<EditPanelTab>(commentsOpen && onCommentsOpenChange ? 'comments' : 'selection');
  // Comments already open on entry are an explicit request to see them: never "open" behind a strip.
  const [collapsed, setCollapsedState] = useState(() => !(commentsOpen && onCommentsOpenChange) && readEditPanelCollapsed());
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    writeEditPanelCollapsed(next);
  }, []);
  const [sheet, setSheet] = useState<'selection' | 'history' | null>(null);

  /** Read by callbacks that run after an await, when `source` may have moved on. */
  const sourceRef = useRef(source);
  const sourceHistory = useRef(new SourceHistory());
  const [markdownDraft, setMarkdownDraft] = useState<string | null>(null);
  const [discardDraft, setDiscardDraft] = useState(false);
  const [rejectedFragment, setRejectedFragment] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // The document's bar is 44px on a desktop; a phone draws none, so the toolbar takes the top there.
  const phone = useIsPhoneViewport();
  const barTop = phone ? 0 : APP_BAR_H;
  sourceRef.current = source;
  const cssRef = useRef(css);
  cssRef.current = css;
  const dataflowRef = useRef(dataflowState);
  dataflowRef.current = dataflowState;
  /** The compiled declarations the document runs on: the served island's, then each compiled draft's. */
  const compiledRef = useRef(art.dataflow?.flow ?? null);
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
   * Show a version of the document in the mounted runtime WITHOUT replacing it.
   *
   * The runtime ships no JSX parser, so the nodes are made here — through the
   * same door the served document and the live stream use, so a pushed version
   * can never describe a different tree than a reload of the same source would.
   */
  const showInDocument = useCallback(
    (next: string, over?: { compiledCss?: string | null; colorMode?: 'light' | 'dark'; refData?: RefDataMap }) => {
      const parts = storyUpdateParts(next, HELD_ASSETS);
      if (!parts) return; // mid-keystroke source that does not parse yet
      const declarationsChanged = parts.declarations !== pushedDeclarations.current;
      sendDocument(
        { frameRef, runtimeRef },
        {
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
          ...(dataflowRef.current && compiledRef.current && declarationsChanged
            ? { dataflow: { flow: compiledRef.current, state: dataflowRef.current } satisfies StoryIslandDataflow }
            : {}),
        },
      );
      pushedDeclarations.current = parts.declarations;
    },
    [frameRef, runtimeRef],
  );

  /** A structural change: source, persistence and the document, in one act. */
  const commitStructural = useCallback(
    (next: string, over?: { refData?: RefDataMap }) => {
      if (next === sourceRef.current) return; // stale path / no-op — never dirty the document
      sourceHistory.current.record(sourceRef.current, next);
      sourceRef.current = next;
      setSource(next);
      queueRef.current?.({ source: next });
      showInDocument(next, over);
    },
    [showInDocument],
  );

  // ── persistence ───────────────────────────────────────────────────────────
  /*
   * The ONE path that replaces the source from outside. The code pane cannot
   * tell that apart from an echo of its own typing by looking at the text (both
   * are just "a different string arrived"), and guessing costs keystrokes — so
   * it is told, and this counter is the telling.
   */
  const [sourceRevision, setSourceRevision] = useState(0);
  const onRemoteDocument = useCallback(
    (next: string) => {
      sourceRef.current = next;
      setSource(next);
      setSourceRevision((n) => n + 1);
      showInDocument(next);
    },
    [showInDocument],
  );

  const editRef = useRef<ReturnType<typeof useInPlaceEdit> | null>(null);
  const isUserEditing = useCallback(() => editRef.current?.isUserEditing() ?? false, []);

  const {
    state: live,
    queue,
    recover,
    flushNow,
    flushForNavigation,
    adoptRemote,
    isOwnEdit,
  } = useLiveEdits({
    backend,
    initialEditId: art.edit_id,
    initialVersion: art.version,
    initialDocument:art.document,
    initialMetadata:{title:art.title,theme:art.theme,template:art.template,colorMode:art.colorMode},
    initialSource: art.markup ?? '',
    onRemoteDocument,
    isUserEditing,
  });
  const queueRef = useRef(queue);
  queueRef.current = queue;

  // insertImage is defined below (it needs commitStructural); the paste/drop
  // door reaches it through this ref so all three insert doors stay ONE path.
  const applyHistory = useCallback(
    async (direction: 'undo' | 'redo') => {
      try {
        await editRef.current?.commitPending();
      } catch (error) {
        setHistoryError(error instanceof Error ? error.message : 'Editor is unavailable.');
        return;
      }
      const result = sourceHistory.current[direction](sourceRef.current);
      if (!result.ok) {
        if (result.reason === 'conflict')
          setHistoryError(
            'Undo is blocked because this content changed elsewhere. Your current document is preserved.',
          );
        return;
      }
      setHistoryError(null);
      sourceRef.current = result.source;
      setSource(result.source);
      setSourceRevision((n) => n + 1);
      queueRef.current({ source: result.source, annotationOps: result.annotationOps });
      showInDocument(result.source);
      if (result.bookmark) editRef.current?.restoreSelection(result.bookmark);
    },
    [showInDocument],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || !['z', 'y'].includes(event.key.toLowerCase()))
        return;
      const target = (event.composedPath()[0] ?? event.target) as HTMLElement;
      if (target.closest('input,textarea') && !target.closest('.monaco-editor')) return;
      event.preventDefault();
      event.stopPropagation();
      void applyHistory(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [applyHistory]);
  /** The image doors the frame reaches (defined below, after commitStructural and the uploads). */
  const imageDoorsRef = useRef<{
    dropped: (file: File, where?: ImageDropPlacement) => void;
    pick: (bodyPath: string) => void;
  } | null>(null);
  const edit = useInPlaceEdit({
    frameRef,
    runtimeRef,
    sessionNonce,
    onError: setHistoryError,
    onRejectedEdit: setRejectedFragment,
    onHistory: (direction) => {
      void applyHistory(direction);
    },
    onImageDrop: useCallback((file: File, where?: ImageDropPlacement) => {
      imageDoorsRef.current?.dropped(file, where);
    }, []),
    onImageReplaceRequest: useCallback((path: string) => {
      imageDoorsRef.current?.pick(path);
    }, []),
    editing: mode === 'design' && !preview,
    sourceRef,
    onSourceEdited: useCallback(
      (next: string, render = false, group?: string, selection?: EditorSelectionChange) => {
        // A text or format edit the DOCUMENT already shows: persist it, but do
        // not push it back — the document runtime's DOM is ahead of us and re-rendering
        // would take the caret with it.
        sourceHistory.current.record(
          sourceRef.current,
          next,
          group,
          selection?.before,
          selection?.after,
          selection?.annotationOperation ? [selection.annotationOperation] : [],
        );
        sourceRef.current = next;
        setSource(next);
        queueRef.current?.({
          source: next,
          annotationOps: selection?.annotationOperation ? [selection.annotationOperation] : undefined,
        });
        if (render) showInDocument(next);
      },
      [showInDocument],
    ),
    onSlideTitle: useCallback(
      (path: string, title: string) => {
        commitStructural(
          updateSlideTitleInJsx(sourceRef.current, bodyPathToSourcePath(sourceRef.current, path), title),
        );
      },
      [commitStructural],
    ),
    onEditKey: useCallback(
      (key: 'Delete' | 'Backspace' | 'Escape', selection: StoryEditSelection | null) => {
        if (key === 'Escape') {
          edit?.select(null);
          return;
        }
        if (!selection) return;
        commitStructural(
          removeJsxNodeAtPath(sourceRef.current, bodyPathToSourcePath(sourceRef.current, selection.path)),
        );
      },
      [commitStructural],
    ), // eslint-disable-line react-hooks/exhaustive-deps
  });
  editRef.current = edit;

  // The edit chunk announces readiness after its listeners exist. Only then
  // restore the node the reader selected in view mode; an earlier mx:select
  // would disappear into a document that was not editing yet.
  useEffect(() => {
    if (edit.ready && initialSelectionPath) edit.select(initialSelectionPath);
  }, [edit.ready, edit.select, initialSelectionPath]);

  // Changes from elsewhere (an agent, another person) while we are editing.
  const remote = useLiveArtifact(backend, art.id, art.edit_id, art.version, true, isOwnEdit);
  useEffect(() => {
    if (!remote || remote.format !== 'markup' || typeof remote.source !== 'string') return;
    if (!adoptRemote(remote.editId, remote.source, remote.by,remote.document,remote.version,{title:remote.title,theme:remote.theme,template:remote.template,colorMode:remote.colorMode})) return;
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
    if (cached !== undefined) {
      setCss(cached);
      showInDocument(key, { compiledCss: cached });
      return;
    }
    const run = async () => {
      // Refused, unreachable or sheetless: the document keeps the sheet it has.
      const body = await backend.previewCss(key).catch(() => null);
      if (!body) return;
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
    compileTimer.current = window.setTimeout(() => {
      void run();
    }, 300);
    return () => window.clearTimeout(compileTimer.current);
  }, [source, showInDocument, backend]);

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
  const queriesUnavailable = backend.unavailable('runQueries');
  useEffect(() => {
    if (flowSignature === null || flowSignature === ranSignature.current) return;
    // A backend that cannot run queries (the offline file) keeps the results the document shipped with.
    if (queriesUnavailable) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      ranSignature.current = flowSignature;
      setDataflowPending(true);
      void backend.previewQueries(sourceRef.current)
        .then((body) => {
          if (!alive) return;
          setDataflowPending(false);
          if (!body) return;
          const next = { values: {}, tables: body.tables, errors: body.errors };
          setDataflowState(next);
          dataflowRef.current = next;
          // The browser has no compiler: the draft's compiled declarations come back with its rows.
          compiledRef.current = body.flow ?? null;
          showInDocument(sourceRef.current);
        })
        .catch(() => { if (alive) setDataflowPending(false); });
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [flowSignature, showInDocument, backend, queriesUnavailable]);

  // ── leaving ───────────────────────────────────────────────────────────────
  /**
   * Leaving collects what the document is still holding FIRST.
   *
   * The document commits a text edit on blur, so the last thing typed exists
   * only in its DOM until somebody asks. Draining before asking drains an
   * empty buffer and loses exactly the edit the reader made last.
   */
  const leave = useCallback(async () => {
    try {
      await editRef.current?.commitPending();
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Editor is unavailable.');
      return;
    }
    await flushNow();
  }, [flushNow]);
  useNavigationGuard(
    useCallback(
      () =>
        flushForNavigation(async () => {
          if (!editRef.current) throw new Error('editor is unavailable');
          await editRef.current.commitPending(true);
        }),
      [flushForNavigation],
    ),
  );

  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => leave();
    return () => {
      flushRef.current = null;
    };
  }, [flushRef, leave]);

  /** A hiding tab may never come back. */
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void leave();
    };
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
  const mermaidEmbed = embedPath && selection?.tag === 'Mermaid' ? readMermaidEmbed(source, embedPath) : null;
  /** Which embed inspector the right rail shows, if any. */
  const inspector = chart ? 'chart' : numberEmbed ? 'number' : mermaidEmbed ? 'diagram' : null;
  const tables = useMemo(() => tableChoices(source, dataflowState), [source, dataflowState]);
  // The compiled record arrives with the state it ran (compiledRef is set beside setDataflowState).
  const queryNotebook = useMemo(() => queryCells(source, dataflowState, dataflowPending, compiledRef.current), [source, dataflowState, dataflowPending]);

  const onChartChange = useCallback(
    (next: { viz: unknown; table: string | null }) => {
      if (!embedPath) return;
      commitStructural(
        updateQuestionChartInJsx(sourceRef.current, embedPath, {
          viz: next.viz as VizEnvelopeValue | undefined,
          table: next.table,
        }),
      );
    },
    [embedPath, commitStructural],
  );

  const onChartTitleChange = useCallback(
    (next: string | null) => {
      if (!embedPath) return;
      commitStructural(updateQuestionTitleInJsx(sourceRef.current, embedPath, next));
    },
    [embedPath, commitStructural],
  );

  const onNumberChange = useCallback(
    (next: NumberEmbedEdit) => {
      if (!embedPath) return;
      commitStructural(updateNumberEmbedInJsx(sourceRef.current, embedPath, next));
    },
    [embedPath, commitStructural],
  );

  const onMermaidChange = useCallback(
    (next: MermaidEmbedEdit) => {
      if (!embedPath) return;
      commitStructural(updateMermaidEmbedInJsx(sourceRef.current, embedPath, next));
    },
    [embedPath, commitStructural],
  );

  const onQuerySqlChange = useCallback(
    (name: string, sql: string) => commitStructural(updateQuerySqlInJsx(sourceRef.current, name, sql)),
    [commitStructural],
  );
  const notebookVisible = queriesOpen && !inspector && mode === 'design' && !preview && queryNotebook.length > 0;
  /*
   * A spotlight is the notebook's, so it leaves with the notebook: a cell that
   * was focused when the rail closed, or when a selection handed the rail to
   * the inspector, gets no blur from React on unmount to clear it.
   */
  const { spotlight, select } = edit;
  useEffect(() => {
    if (notebookVisible) return;
    spotlight([]);
    setQueryFocus(null);
  }, [notebookVisible, spotlight]);
  /*
   * "Select an element to format" is an instruction you cannot follow from the
   * source or the query notebook — there is no page there to select on. So the
   * app view draws both rows and every other view draws one, and the panes
   * below start at whichever height the bar actually is.
   */
  const formattingRow = mode === 'design' && !notebookVisible;
  const barH = formattingRow ? EDIT_BAR_H : EDIT_BAR_ROW_H;
  /*
   * THE ONE WIDTH the page is told about: the panel's, which nothing in the
   * session changes but collapse / expand (and a window crossing the
   * breakpoint). Not a selection, not a tab on an open panel, not a preview
   * or the code view — each of those used to move the document sideways,
   * usually right under whatever the pointer was reaching for.
   */
  const panelWidth = wide ? editPanelWidth(collapsed) : 0;
  // Through a ref: a caller passing a fresh callback each render must not get
  // a 0 from the old one's cleanup — that is the flicker this width exists to prevent.
  const onRightInsetChangeRef = useRef(onRightInsetChange);
  onRightInsetChangeRef.current = onRightInsetChange;
  useEffect(() => {
    onRightInsetChangeRef.current?.(panelWidth);
  }, [panelWidth]);
  // Leaving edit mode gives the width back; the page must not keep a gap for a panel that has gone.
  useEffect(() => () => onRightInsetChangeRef.current?.(0), []);

  /*
   * THE TAB FOLLOWS THE PAGE'S COMMENTS RAIL, both ways: a pin click, the
   * reader bar's comment glyph or a posted comment opens it from outside, and
   * closing the rail from its own header hands the panel back to Selection.
   */
  const commentsTab = !!onCommentsOpenChange;
  /*
   * EXPLICIT REQUESTS EXPAND a collapsed panel — a tab icon, Edit chart, a
   * double-click, comments opened from anywhere — and clear the saved choice:
   * that is the person asking, so the one width change is theirs. A selection
   * on its own never does. Comments therefore can never be open with nothing
   * visible.
   */
  useEffect(() => {
    if (!commentsTab) return;
    if (commentsOpen) {
      setPanelTab('comments');
      setSheet(null);
      setCollapsedState((current) => {
        if (current) writeEditPanelCollapsed(false);
        return false;
      });
    } else setPanelTab((current) => (current === 'comments' ? 'selection' : current));
  }, [commentsOpen, commentsTab]);
  const chooseTab = useCallback(
    (next: EditPanelTab) => {
      if (collapsed) setCollapsed(false);
      setPanelTab(next);
      if (next === 'comments') onCommentsOpenChange?.(true);
      else if (commentsOpen) onCommentsOpenChange?.(false);
    },
    [collapsed, setCollapsed, commentsOpen, onCommentsOpenChange],
  );
  /*
   * On any other tab a new selection does not take the panel over — the
   * Selection tab carries a dot instead, and Edit chart or a double-click on
   * the chart is how you ask for it.
   */
  const selectionDot = panelTab !== 'selection' && inspector !== null && mode === 'design' && !preview;

  /**
   * BELOW THE BREAKPOINT a sheet covers the lower half, so the selected thing is
   * scrolled into the half above it — just under the bars. The page keeps a
   * half-screen of room under the document for the whole narrow session
   * (ArtifactSurface), so this can reach the last chart and closing the sheet
   * has nothing to clamp.
   */
  const revealAboveSheet = useCallback(() => {
    const rect = selectionRef.current?.rect;
    if (!rect) return;
    const top = barTop + barH + 8;
    if (rect.y >= top && rect.y + rect.height <= window.innerHeight / 2) return;
    window.scrollBy({ top: rect.y - top, behavior: 'smooth' });
  }, [barTop, barH]);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const openSheet = useCallback(
    (next: 'selection' | 'history' | null) => {
      if (next && commentsOpen) onCommentsOpenChange?.(false);
      // Asked again while it is already up (a double-tap that also fires
      // dblclick): the rect it would scroll by is the one already used.
      const reveal = next === 'selection' && sheetRef.current !== 'selection';
      sheetRef.current = next;
      setSheet(next);
      if (reveal) revealAboveSheet();
    },
    [commentsOpen, onCommentsOpenChange, revealAboveSheet],
  );
  /** "Show me what is selected": the Selection tab on a wide window, its sheet below that. */
  const inspectSelection = useCallback(() => {
    if (wide) chooseTab('selection');
    else openSheet('selection');
  }, [wide, chooseTab, openSheet]);
  const inspectRef = useRef({ inspectSelection, inspector });
  inspectRef.current = { inspectSelection, inspector };
  /*
   * DOUBLE-CLICK (or double-tap) ON THE SELECTED EMBED opens its inspector. The
   * document runtime shares this window, so the page listens — capture phase,
   * nothing prevented — and acts only on a point inside the document viewport
   * and inside the selection's own rect: the first click selected it.
   */
  useEffect(() => {
    let lastTap = { at: -Infinity, x: 0, y: 0 };
    // A touch double-tap may ALSO arrive as dblclick; the tap already answered it.
    let touchOpenedAt = -Infinity;
    const hit = (event: MouseEvent) => {
      const { inspector: kind } = inspectRef.current;
      const rect = selectionRef.current?.rect;
      if (!kind || !rect) return false;
      const target = event.target as Element | null;
      if (!target?.closest?.('[aria-label="Artifact viewport"]')) return false;
      const { clientX: x, clientY: y } = event;
      return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
    };
    const onDoubleClick = (event: MouseEvent) => {
      if (event.timeStamp - touchOpenedAt < 1000) return;
      if (hit(event)) inspectRef.current.inspectSelection();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      const near = Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= DOUBLE_TAP_PX;
      if (event.timeStamp - lastTap.at <= DOUBLE_TAP_MS && near) {
        lastTap = { at: -Infinity, x: 0, y: 0 };
        if (hit(event)) {
          touchOpenedAt = event.timeStamp;
          inspectRef.current.inspectSelection();
        }
        return;
      }
      lastTap = { at: event.timeStamp, x: event.clientX, y: event.clientY };
    };
    window.addEventListener('dblclick', onDoubleClick, true);
    window.addEventListener('pointerup', onPointerUp, true);
    return () => {
      window.removeEventListener('dblclick', onDoubleClick, true);
      window.removeEventListener('pointerup', onPointerUp, true);
    };
  }, []);
  /** "edit in queries" from an inspector: the selection goes (the inspector holds the rail), the notebook lands on the cell. */
  const onOpenQuery = useCallback(
    (name: string) => {
      select(null);
      setQueryFocus(name);
      setQueriesOpen(true);
    },
    [select],
  );

  const deleteSelected = useCallback(() => {
    if (!selection) return;
    commitStructural(removeJsxNodeAtPath(sourceRef.current, bodyPathToSourcePath(sourceRef.current, selection.path)));
    edit.select(null);
  }, [selection, commitStructural, edit]);

  // ── images ────────────────────────────────────────────────────────────────
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  /**
   * The insert/replace dialog, with its TARGET captured when it opened: focus
   * moving into the dialog can clear the document's selection, and the upload
   * is async — the node the person was on is remembered, not re-read.
   */
  const [imageDialog, setImageDialog] = useState<
    { mode: 'insert'; anchor: JsxInsertAnchor | null } | { mode: 'replace'; target: JsxImageTarget } | null
  >(null);

  /**
   * The URL door and the upload door (lib/artifact-backend): the source gets
   * `ref:<id>` either way, and a refusal comes back as the sentence to show.
   */
  const importImageUrl = useCallback((url: string): Promise<ImageChoice> => backend.importImage({ imageUrl: url }), [backend]);
  const uploadImage = useCallback((file: File): Promise<ImageChoice> => backend.importImage({ file, name: file.name }), [backend]);

  /** Typing the document has not committed yet must be in the source an image edit composes against. */
  const drainTyping = useCallback(async (): Promise<boolean> => {
    try {
      await editRef.current?.commitPending();
      return true;
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Could not change the document.');
      return false;
    }
  }, []);

  /** The anchor for "the node the person is on", captured from a BODY path now. */
  const anchorAt = useCallback((bodyPath: string | null | undefined): JsxInsertAnchor | null => {
    if (!bodyPath) return null;
    return nodeTargetInJsx(sourceRef.current, bodyPathToSourcePath(sourceRef.current, bodyPath));
  }, []);

  /**
   * INSERT — the one path every insert door ends in: placed at the anchor
   * (lib/data/story/jsx-edit placeImageInJsx), one structural commit (one undo
   * step), then selected and scrolled into view so it is plainly there.
   */
  const insertImage = useCallback(
    async (anchor: JsxInsertAnchor | null, image: ChosenImage) => {
      if (!(await drainTyping())) return;
      const nodeId = freshNodeId(sourceRef.current);
      const placed = placeImageInJsx(sourceRef.current, image.id, anchor, { nodeId });
      if (placed.source === sourceRef.current || !placed.path) return;
      commitStructural(placed.source, refDataFor(image));
      const bodyPath = sourcePathToBodyPath(placed.source, placed.path);
      if (bodyPath) editRef.current?.select(bodyPath, { reveal: true, nodeId });
    },
    [commitStructural, drainTyping],
  );

  /**
   * REPLACE — the one path every replace door ends in. Only `src` changes, as
   * one structural commit: one undo step, the old asset untouched.
   */
  const replaceImage = useCallback(
    async (target: JsxImageTarget, image: ChosenImage) => {
      if (!(await drainTyping())) return;
      const next = replaceImageSrcInJsx(sourceRef.current, target, image.id);
      if (next === sourceRef.current) {
        setImageError('That image changed while the new one was uploading. Select it and try again.');
        return;
      }
      commitStructural(next, refDataFor(image));
    },
    [commitStructural, drainTyping],
  );

  /** The image a BODY path names, captured now — null when it is not a plain <img>. */
  const imageTargetAt = useCallback(
    (bodyPath: string) => imageTargetInJsx(sourceRef.current, bodyPathToSourcePath(sourceRef.current, bodyPath)),
    [],
  );

  /** Doors without a dialog (paste, drop, the double-click picker) show a refusal in the banner. */
  const uploadOrSay = useCallback(
    async (file: File): Promise<ChosenImage | null> => {
      if (!file.type.startsWith('image/')) return null;
      setImageError(null);
      const result = await uploadImage(file);
      if (!result.ok) setImageError(result.error);
      return result.ok ? result.image : null;
    },
    [uploadImage],
  );

  const replaceInputRef = useRef<HTMLInputElement>(null);
  /** The image the double-click picker is open for, captured at the double-click. */
  const replacePickRef = useRef<JsxImageTarget | null>(null);
  imageDoorsRef.current = {
    /** A paste (placed at the selection) or a drop (onto an image, or into a gap). */
    dropped: (file, where) => {
      if (where?.replace) {
        const target = imageTargetAt(where.replace);
        if (!target) return;
        void uploadOrSay(file).then((image) => image && replaceImage(target, image));
        return;
      }
      const anchor = where && 'at' in where
        ? (where.at ? { ...(anchorAt(where.at.path) ?? { path: '' }), side: where.at.side } : null)
        : anchorAt(selectionRef.current?.path);
      void uploadOrSay(file).then((image) => image && insertImage(anchor?.path ? anchor : null, image));
    },
    /** A double-click on an image: straight to the file picker, while the click's activation lasts. */
    pick: (bodyPath) => {
      replacePickRef.current = imageTargetAt(bodyPath);
      if (replacePickRef.current) replaceInputRef.current?.click();
    },
  };

  const openInsertDialog = useCallback(() => {
    setImageMenuOpen(false);
    setImageDialog({ mode: 'insert', anchor: anchorAt(selectionRef.current?.path) });
  }, [anchorAt]);

  /** The image toolbar's half: alt text read from the SOURCE (the selection is a DOM snapshot), and the doors. */
  const selectedImagePath = selection?.tag === 'img' ? selection.path : null;
  const selectedImageAlt = useMemo(
    () => (selectedImagePath ? imageAltInJsx(source, { path: bodyPathToSourcePath(source, selectedImagePath) }) : null),
    [source, selectedImagePath],
  );
  const imageControls = selectedImagePath
    ? {
        alt: selectedImageAlt,
        onReplace: () => {
          const target = imageTargetAt(selectedImagePath);
          if (target) setImageDialog({ mode: 'replace', target });
        },
        onAlt: (alt: string) =>
          commitStructural(
            setImageAltInJsx(sourceRef.current, { path: bodyPathToSourcePath(sourceRef.current, selectedImagePath) }, alt),
          ),
      }
    : undefined;

  // ── version history ───────────────────────────────────────────────────────
  const history = useArtifactVersions({ backend, currentVersion: live.version });
  /** History is a server capability: without it the entry points stay, disabled, saying why. */
  const historyUnavailable = backend.unavailable('versions');

  /**
   * Looking at an older version shows it IN the document — same runtime, same
   * engine that renders the real thing. Editing is off while it is up: this
   * editor has no save button, so typing into an old version would quietly
   * publish it.
   */
  const previewVersion = useCallback(
    async (v: number) => {
      const snapshot = await history.fetchVersion(v);
      if (!snapshot) return;
      setPreview(snapshot);
      edit.select(null);
      showInDocument(snapshot.markup ?? '', {
        compiledCss: snapshot.meta.compiledCss ?? cssRef.current,
        colorMode: snapshot.meta.colorMode ?? colorModeRef.current,
      });
    },
    [history, showInDocument, edit],
  );

  const backToCurrent = useCallback(() => {
    setPreview(null);
    showInDocument(sourceRef.current);
  }, [showInDocument]);

  const restoreVersion = useCallback(
    async (v: number) => {
      let next: number | null;
      // A refusal the server explained (a version the current engine cannot restore) is shown, not swallowed.
      try { next = await history.restore(v); } catch (error) { setHistoryError(error instanceof Error ? error.message : 'Could not restore that version.'); return; }
      if (next === null) return;
      // The restored state IS the document now; the live stream delivers it on
      // the same path an agent's edit arrives on.
      setPreview(null);
      await history.refresh();
    },
    [history],
  );

  const historyControls = (
    <>
      <Tooltip content="Undo (Ctrl/Cmd Z)">
        <button
          type="button"
          aria-label="Undo"
          disabled={!sourceHistory.current.canUndo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void applyHistory('undo')}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-fg disabled:opacity-30"
        >
          <Undo2 size={14} />
        </button>
      </Tooltip>
      <Tooltip content="Redo (Ctrl/Cmd Shift Z)">
        <button
          type="button"
          aria-label="Redo"
          disabled={!sourceHistory.current.canRedo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void applyHistory('redo')}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-fg disabled:opacity-30"
        >
          <Redo2 size={14} />
        </button>
      </Tooltip>
    </>
  );
  const insertionControls = (
    <StoryToolbarMenu label="Insert" open={imageMenuOpen} onOpenChange={setImageMenuOpen}>
      <div className="flex w-44 flex-col">
        <button
          type="button"
          onClick={openInsertDialog}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-raised"
        >
          Image…
        </button>
        <button
          type="button"
          aria-label="Paste Markdown"
          onClick={() => {
            setImageMenuOpen(false);
            setMarkdownDraft('');
          }}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-raised"
        >
          Paste Markdown
        </button>
      </div>
    </StoryToolbarMenu>
  );

  /*
   * THE SELECTION TAB'S BODY — the inspector for the selected embed, or the
   * hint. The same body on a wide window's panel and in a narrow window's sheet.
   * No delete here: the selection toolbar offers it for EVERY selection
   * (lib/story/selection-toolbar ALWAYS_OFFERED), and a second trash an inch
   * from `close` was the one people hit by mistake. The inspector inspects;
   * the toolbar acts on the node.
   */
  const InspectIcon = inspector ? INSPECT_ICON[inspector] : null;
  /** An embed whose inspector can show now: the toolbar offers Edit chart / number / diagram. */
  const inspectable = !!inspector && mode === 'design' && !preview;
  const selectionBody = inspector && mode === 'design' && !preview ? (
    <section aria-label={INSPECTOR_LABEL[inspector]}>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wide text-faint">{inspector}</span>
        {/* Deselects. The panel's only: a sheet's own close puts the sheet away instead. */}
        {wide && (
          <button
            type="button"
            aria-label={`Close ${INSPECTOR_LABEL[inspector].toLowerCase()}`}
            onClick={() => edit.select(null)}
            className="cursor-pointer font-mono text-[11px] text-muted hover:text-fg"
          >
            close
          </button>
        )}
      </div>
      {chart ? (
        <VizEditorPanel
          viz={chart.viz}
          title={chart.title}
          table={chart.table}
          tables={tables}
          onChange={onChartChange}
          onTitleChange={onChartTitleChange}
          onOpenQuery={onOpenQuery}
        />
      ) : numberEmbed ? (
        <NumberEditorPanel binding={numberEmbed} tables={tables} onChange={onNumberChange} onOpenQuery={onOpenQuery} />
      ) : (
        <MermaidEditorPanel embed={mermaidEmbed!} onChange={onMermaidChange} />
      )}
    </section>
  ) : (
    <p className="px-1 py-2 font-sans text-xs text-muted">{SELECTION_HINT}</p>
  );

  return (
    <div className="contents" data-app-appearance={surfaceMode}>
      {/* The double-click picker: a file chosen here replaces the image that was double-clicked. */}
      <input
        ref={replaceInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        aria-label="Replacement image file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          const target = replacePickRef.current;
          replacePickRef.current = null;
          e.target.value = '';
          if (f && target) void uploadOrSay(f).then((image) => image && replaceImage(target, image));
        }}
      />
      {imageDialog && (
        <ImageDialog
          mode={imageDialog.mode}
          onUploadFile={uploadImage}
          onImportUrl={importImageUrl}
          onClose={() => setImageDialog(null)}
          onConfirm={(image) => {
            const open = imageDialog;
            setImageDialog(null);
            if (open.mode === 'insert') void insertImage(open.anchor, image);
            else void replaceImage(open.target, image);
          }}
        />
      )}
      {markdownDraft !== null && (
        <MarkdownPasteDialog
          value={markdownDraft}
          onChange={setMarkdownDraft}
          onClose={() => setMarkdownDraft(null)}
          onInsert={() => {
            edit.pasteMarkdown(markdownDraft);
            setMarkdownDraft(null);
          }}
        />
      )}
      {live.status.startsWith('not saved') && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 max-w-md rounded border border-edge bg-surface p-3 text-sm"
        >
          <p>{live.status}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" onClick={() => void recover('retry')}>
              Retry save
            </button>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(sourceRef.current)
                  .catch(() => setHistoryError('Could not copy. Open the source editor to select and copy your draft.'))
              }
            >
              Copy draft
            </button>
            <button type="button" onClick={() => setDiscardDraft(true)}>
              Use server version
            </button>
          </div>
          {discardDraft && (
            <div role="alertdialog" aria-label="Discard unsaved draft" className="mt-3 border-t border-edge pt-3">
              <p>Replace your unsaved draft with the server version? Copy your draft first if you want to keep it.</p>
              <button
                type="button"
                onClick={() => {
                  setDiscardDraft(false);
                  void recover('server');
                }}
              >
                Discard draft and load server
              </button>
              <button type="button" onClick={() => setDiscardDraft(false)}>
                Keep editing
              </button>
            </div>
          )}
        </div>
      )}
      {rejectedFragment !== null && (
        <div
          role="alertdialog"
          aria-label="Recover uncommitted text"
          className="fixed inset-x-4 top-28 z-50 mx-auto max-w-xl rounded border border-edge bg-surface p-4 shadow-xl"
        >
          <p>This text could not be applied to the current document. Copy it before restoring the document.</p>
          <textarea
            aria-label="Uncommitted text"
            readOnly
            value={rejectedFragment}
            className="mt-2 h-32 w-full font-mono text-sm"
          />
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(rejectedFragment)
                .catch(() => setHistoryError('Select and copy the text from the field.'))
            }
          >
            Copy uncommitted text
          </button>
          <button
            type="button"
            onClick={() => {
              edit.discardRejectedEdit();
              setRejectedFragment(null);
              showInDocument(sourceRef.current);
            }}
          >
            Discard this text and restore document
          </button>
        </div>
      )}
      {historyError && (
        <div role="alert" className="fixed bottom-4 left-4 z-50 rounded border border-edge bg-surface p-3 text-sm">
          {historyError}
          <button type="button" onClick={() => setHistoryError(null)} aria-label="Dismiss undo message">
            {' '}
            ×
          </button>
        </div>
      )}
      <header
        aria-label="Editor toolbar"
        className={`fixed z-30 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 bg-surface px-3 ${
          formattingRow ? 'grid-rows-[44px_44px]' : 'grid-rows-[44px]'
        }`}
        style={{ top: barTop, height: barH, left: 0, right: rightInset }}
      >
        {/* Settings scroll independently; mode, history and Done stay visible.
            The formatting row below owns its own overflow and portalled menus. */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:gap-2">
          <input
            aria-label="Title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              queue({ title: e.target.value });
            }}
            placeholder="untitled"
            className="w-0 min-w-[3.5rem] flex-1 rounded-[4px] border border-transparent bg-transparent px-1.5 py-1 font-mono text-xs font-semibold text-fg hover:border-edge focus:border-edge-bright focus:outline-none sm:w-48 sm:flex-none sm:shrink-0"
          />
          {/*
            * WHAT YOU ARE EDITING: app and code are two renderings of the
            * document, data is the queries it reads — three views of ONE
            * document, so choosing any of them leaves the other two. First of
            * the document-wide choices (theme and mode follow), so a narrow
            * bar that scrolls this row still shows it.
            */}
          <div role="group" aria-label="Editor view" className="flex shrink-0 items-center rounded-[4px] border border-edge p-0.5">
            {/* Icon-only on a phone, where every control in this row must fit; the names stay. */}
            {(
              [
                ['design', 'app', <Paintbrush key="d" size={12} />, mode === 'design' && !queriesOpen],
                ['code', 'code', <Code key="c" size={12} />, mode === 'code'],
              ] as const
            ).map(([m, label, icon, active]) => (
              <Tooltip key={m} content={m === 'design' ? 'edit on the page' : 'edit the source'}>
              <button
                type="button"
                aria-label={m === 'design' ? 'Edit on the page' : 'Edit the source'}
                aria-pressed={active}
                onClick={() => {
                  setMode(m);
                  setQueriesOpen(false);
                }}
                className={`inline-flex h-6 cursor-pointer items-center gap-1 rounded-[3px] px-1 font-mono text-[11px] sm:px-1.5 ${
                  active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg'
                }`}
              >
                {icon}
                <span className="hidden sm:inline">{label}</span>
              </button>
              </Tooltip>
            ))}
            {queryNotebook.length > 0 && (
              <Tooltip content="the document's queries">
              <button
                type="button"
                aria-label="Show data"
                aria-pressed={queriesOpen}
                onClick={() => {
                  setQueriesOpen((v) => !v);
                  setMode('design');
                  // The notebook is a view over the document: nothing on the page is selected under it.
                  if (!queriesOpen) edit.select(null);
                }}
                className={`inline-flex h-6 cursor-pointer items-center gap-1 rounded-[3px] px-1 font-mono text-[11px] sm:px-1.5 ${
                  queriesOpen ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg'
                }`}
              >
                <Database size={12} />
                <span className="hidden sm:inline">data</span>
              </button>
              </Tooltip>
            )}
          </div>
          <ThemePicker
            value={theme}
            colorMode={colorMode}
            onPick={(t) => {
              setTheme(t);
              queue({ theme: t });
              // The document carries its own design attributes; tell it directly
              // rather than making it wait for the save to come back around. With
              // no author pick the MODE follows the new theme's declared default.
              sendDocument(
                { frameRef, runtimeRef },
                {
                  type: 'mx:document',
                  nodes: storyUpdateParts(sourceRef.current, HELD_ASSETS)?.nodes ?? [],
                  theme: t,
                  colorMode: colorMode ?? storyThemeDefaultMode(t) ?? 'light',
                },
              );
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

        <div aria-label="Document actions" className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span role="status" className="hidden text-xs text-muted lg:inline">
            {live.status || (live.pending ? 'Saving…' : `v${live.version} · Saved`)}
          </span>
          {wide && inspectable && inspector && InspectIcon && (
            <Tooltip content={`${INSPECT_LABEL[inspector]} settings`}>
              <button
                type="button"
                aria-label={INSPECT_LABEL[inspector]}
                onClick={inspectSelection}
                className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-[4px] border border-edge px-1.5 font-mono text-[11px] text-muted hover:border-edge-bright hover:text-fg"
              >
                <InspectIcon size={12} className="shrink-0" />
                <span className="hidden lg:inline">{INSPECT_LABEL[inspector]}</span>
              </button>
            </Tooltip>
          )}
          {/* Below the panel breakpoint the panel's tabs are these three, each a
              bottom sheet. The selection one IS Edit chart while a chart is
              selected: one control, not two beside each other on a phone. */}
          {!wide && (
            <>
              <Tooltip content={inspectable && inspector ? `${INSPECT_LABEL[inspector]} settings` : 'selection settings'}>
                <button
                  type="button"
                  aria-label={inspectable && inspector ? INSPECT_LABEL[inspector] : 'Show selection settings'}
                  aria-expanded={sheet === 'selection'}
                  onClick={() => openSheet(sheet === 'selection' ? null : 'selection')}
                  className={narrowTabClass(sheet === 'selection')}
                >
                  {inspectable && InspectIcon ? <InspectIcon size={12} className="shrink-0" /> : <SlidersHorizontal size={12} className="shrink-0" />}
                </button>
              </Tooltip>
              <FeatureGate reason={historyUnavailable}>
                {(gate) => {
                  const button = (
                    <button
                      type="button"
                      aria-label="Open version history"
                      aria-expanded={sheet === 'history'}
                      onClick={() => openSheet(sheet === 'history' ? null : 'history')}
                      className={`${narrowTabClass(sheet === 'history')} disabled:cursor-default disabled:opacity-50`}
                      {...gate}
                    >
                      <History size={12} className="shrink-0" />
                    </button>
                  );
                  return gate.disabled ? button : <Tooltip content="version history">{button}</Tooltip>;
                }}
              </FeatureGate>
              {commentsTab && (
                <Tooltip content="comments">
                  <button
                    type="button"
                    aria-label="Show comments"
                    aria-expanded={commentsOpen}
                    onClick={() => {
                      setSheet(null);
                      onCommentsOpenChange?.(!commentsOpen);
                    }}
                    className={narrowTabClass(commentsOpen)}
                  >
                    <MessageSquare size={12} className="shrink-0" />
                  </button>
                </Tooltip>
              )}
            </>
          )}
          <Tooltip content="done editing">
            <button
              type="button"
              aria-label="Exit edit mode"
              onClick={(event) => {
                event.currentTarget.blur();
                void onDone();
              }}
              className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[4px] border border-accent/40 bg-accent-soft px-2 font-mono text-[11px] text-accent hover:border-accent"
            >
              <Check size={13} />
              <span className="hidden sm:inline">Done</span>
            </button>
          </Tooltip>
        </div>
        {formattingRow && (
        <div className="col-span-2 min-w-0 self-start">
          {selection && mode === 'design' ? (
            <StoryFormatToolbar artifactId={art.id}
              selection={selection}
              onApply={edit.applyFormat}
              onApplyLink={edit.applyLink}
              onApplyInline={edit.applyInline}
              onAutoHeight={() =>
                commitStructural(
                  editBlock(sourceRef.current, {
                    kind: 'auto-height',
                    path: selection.path,
                  }),
                )
              }
              historyControls={historyControls}
              insertionControls={insertionControls}
              onSelect={edit.select}
              onDelete={deleteSelected}
              onComment={onComment}
              image={imageControls}
            />
          ) : (
            <div className="flex flex-col">
              <div
                aria-label="Primary formatting controls"
                className="flex h-9 items-center gap-1 overflow-x-auto rounded-lg bg-raised px-2"
              >
                {historyControls}
                <span className="shrink-0 px-2 text-[11px] text-muted">
                  {mode === 'design' ? 'Select an element to format' : 'Editing source'}
                </span>
                {mode === 'design' && insertionControls}
              </div>
            </div>
          )}
        </div>
        )}
      </header>

      {imageError && (
        <div
          aria-label="Image upload error"
          className="fixed z-30 flex items-center justify-between gap-3 border-b border-red-300 bg-red-50 px-4 py-1.5 font-mono text-[11px] text-red-800"
          style={{ top: barTop + barH, left: 0, right: panelWidth }}
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
        <div className="fixed bottom-0 z-20" style={{ top: barTop + barH, left: 0, right: panelWidth }} aria-label="Source pane">
          <SourceEditor
            value={source}
            revision={sourceRevision}
            onChange={(text) => {
              sourceHistory.current.record(sourceRef.current, text);
              sourceRef.current = text;
              setSource(text);
              queue({ source: text });
            }}
          />
        </div>
      )}

      {/*
        * THE PANEL (wide) or its SHEETS (narrow). The inspector, the version list
        * and the comments rail are one column that is there for the whole
        * session, so selecting a chart fills it instead of opening it — the
        * document never moves under the pointer. The page decides whether the
        * column comes out of the document's margin or its width.
        */}
      {wide && (
        <EditPanel
          top={barTop + barH}
          tab={panelTab}
          onTab={chooseTab}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          selectionDot={selectionDot}
          commentsAvailable={commentsTab}
        >
          {collapsed ? null : panelTab === 'selection' ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{selectionBody}</div>
          ) : panelTab === 'history' ? (
            <VersionHistory
              embedded
              versions={history.versions ?? []}
              currentVersion={live.version}
              previewing={preview?.version ?? null}
              onPreview={(v: number) => void previewVersion(v)}
              onRestore={(v: number) => void restoreVersion(v)}
              onBackToCurrent={backToCurrent}
              onClose={() => {}}
              busy={history.busy}
            />
          ) : (
            <div ref={onCommentsHost} className="flex min-h-0 flex-1 flex-col" />
          )}
        </EditPanel>
      )}
      {!wide && sheet === 'selection' && (
        <TrustedUi overlay layer="navigation">
          <MobileSheet
            label="Selection settings"
            size="half"
            swipeToClose
            onClose={() => setSheet(null)}
            header={
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="font-mono text-xs font-semibold text-fg">selection</span>
                <button
                  type="button"
                  aria-label="Close selection settings"
                  onClick={() => setSheet(null)}
                  className="cursor-pointer rounded p-1 text-muted hover:text-fg"
                >
                  <X size={13} />
                </button>
              </div>
            }
          >
            {selectionBody}
          </MobileSheet>
        </TrustedUi>
      )}

      {/* The query notebook: a VIEW over the document, like the source pane — it
          ends at the panel's edge and reserves nothing, so opening it moves no
          width. Design mode only: in code mode the SQL is already on screen. */}
      {notebookVisible && (
        <aside
          aria-label="Data"
          className="fixed bottom-0 z-20 overflow-y-auto bg-surface p-4"
          style={{ top: barTop + barH, left: 0, right: panelWidth }}
        >
          <QueryNotebookPanel
            cells={queryNotebook}
            onSqlChange={onQuerySqlChange}
            onSpotlight={edit.spotlight}
            focus={queryFocus}
            titles={Object.fromEntries((art.refs ?? []).map((r) => [r.id, r.title ?? null]))}
          />
        </aside>
      )}

      {!wide && sheet === 'history' && (
        // The open sheet must receive clicks ABOVE the reader's navigation
        // rail; without this wrapper a trusted-ui layer swallows them.
        <TrustedUi overlay layer="navigation">
        <VersionHistory
          sheet
          topOffset={barTop + barH}
          versions={history.versions ?? []}
          currentVersion={live.version}
          previewing={preview?.version ?? null}
          onPreview={(v: number) => void previewVersion(v)}
          onRestore={(v: number) => void restoreVersion(v)}
          onBackToCurrent={backToCurrent}
          onClose={() => setSheet(null)}
          busy={history.busy}
        />
        </TrustedUi>
      )}
    </div>
  );
}
