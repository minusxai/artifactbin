/* @jsxImportSource solid-js */
/**
 * EDITING, IN THE DOCUMENT THE READER IS ALREADY LOOKING AT.
 *
 * The page's adopted compiled document (solid/document/create-island-story) becomes editable in
 * place; this component owns the editing chrome, source composition, persistence and history.
 *
 * Division of labour:
 *   runtime (lib/story-runtime/edit/session) — makes hosts editable, says what is selected, stages
 *          what was typed, applies a format instantly.
 *   here   — composes every edit into the source, persists through the save-less protocol
 *          (solid/editor/create-live-edits), and pushes structural changes back down as
 *          `mx:document`, which the controller previews through the server compiler.
 */
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, For, Show, untrack, type JSX } from 'solid-js';
import { firstHeadingTitle } from '@/lib/story/document/title';
import { Portal } from 'solid-js/web';
import { useBeforeLeave } from '@solidjs/router';
import ChartColumn from 'lucide-solid/icons/chart-column';
import Check from 'lucide-solid/icons/check';
import Code from 'lucide-solid/icons/code';
import Database from 'lucide-solid/icons/database';
import Smartphone from 'lucide-solid/icons/smartphone';
import { readPwaSettings } from '@/lib/story/reader/pwa-settings';
import { PwaSettingsPanel, PwaSharingSetting } from './PwaSettingsPanel';
import Files from 'lucide-solid/icons/files';
import Share2 from 'lucide-solid/icons/share-2';
import Hash from 'lucide-solid/icons/hash';
import History from 'lucide-solid/icons/history';
import MessageSquare from 'lucide-solid/icons/message-square';
import Undo2 from 'lucide-solid/icons/undo-2';
import Redo2 from 'lucide-solid/icons/redo-2';
import Paintbrush from 'lucide-solid/icons/paintbrush';
import SlidersHorizontal from 'lucide-solid/icons/sliders-horizontal';
import Workflow from 'lucide-solid/icons/workflow';
import X from 'lucide-solid/icons/x';
import type { DocumentGraph } from '@artifactbin/contracts';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import type { DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { editBlock } from '@/lib/editor-v2/block-edit';
import { APP_BAR_H, EDIT_BAR_H } from '@/lib/story/reader/edit-bar';
import { storyUpdateParts } from '@/lib/story/document/update-parts';
import { bodyPathToSourcePath, sourcePathToBodyPath } from '@/lib/story/document/edit-compose';
import {
  freshNodeId, imageAltInJsx, imageTargetInJsx, nodeTargetInJsx, placeImageInJsx, removeJsxNodeAtPath,
  replaceImageSrcInJsx, setImageAltInJsx, type JsxImageTarget, type JsxInsertAnchor,
} from '@/lib/data/story/jsx-edit';
import { readQuestionChart, updateQuestionChartInJsx, updateQuestionTitleInJsx, type VizEnvelopeValue } from '@/lib/data/story/story-viz';
import { readNumberEmbed, updateNumberEmbedInJsx, type NumberEmbedEdit } from '@/lib/data/story/story-number';
import { readMermaidEmbed, updateMermaidEmbedInJsx, type MermaidEmbedEdit } from '@/lib/data/story/story-mermaid';
import { updateSlideTitleInJsx } from '@/lib/data/story/story-slides';
import { tableChoices } from '@/lib/story/data/table-catalog';
import { queryCells, updateQuerySqlInJsx } from '@/lib/story/data/query-notebook';
import { storyThemeDefaultMode } from '@/lib/data/story/story-themes';
import type { DataflowState } from '@/lib/story/data/dataflow';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import type { StoryEditSelection, StoryIslandDataflow } from '@/lib/story-runtime/contract';
import type { ArtifactVersionSnapshot } from '@/lib/artifact-backend/types';
import { createInPlaceEdit, type ImageDropPlacement, type InPlaceEditController } from './create-in-place-edit';
import { createLiveEdits } from './create-live-edits';
import { createEditorSource } from './create-editor-source';
import { createEditDraftSender } from './edit-draft';
import { createLiveArtifact } from './create-live-artifact';
import { createArtifactVersions } from './create-versions';
import { createWideEditViewport, editPanelWidth, readEditPanelCollapsed, writeEditPanelCollapsed } from './create-edit-panel';
import EditPanel, { SELECTION_HINT, type EditPanelTab } from './EditPanel';
import StoryFormatToolbar from './StoryFormatToolbar';
import { StoryToolbarMenu } from './StoryToolbarMenu';
import SourceEditorPane from './SourceEditorPane';
import ReferenceFilesPanel from './ReferenceFilesPanel';
import VizEditorPanel from './panels/VizEditorPanel';
import NumberEditorPanel from './panels/NumberEditorPanel';
import MermaidEditorPanel from './panels/MermaidEditorPanel';
import QueryNotebookPanel from './panels/QueryNotebookPanel';
import ImageDialog, { IMAGE_ACCEPT, type ChosenImage, type ImageChoice } from './panels/ImageDialog';
import MarkdownPasteDialog from './panels/MarkdownPasteDialog';
import ThemePicker, { ModeChip, TemplateChip } from './ThemePicker';
import { VersionHistory } from '../document/VersionHistory';
import { Tooltip } from '../components/Tooltip';
import { FeatureGate } from '../components/FeatureGate';
import MobileSheet, { createIsPhoneViewport } from '../components/MobileSheet';
import { copyText } from '../lib/copy-text';

const INSPECTOR_LABEL = { chart: 'Chart inspector', number: 'Number inspector', diagram: 'Diagram inspector' } as const;
const INSPECT_LABEL = { chart: 'Edit chart', number: 'Edit number', diagram: 'Edit diagram' } as const;
const INSPECT_ICON = { chart: ChartColumn, number: Hash, diagram: Workflow } as const;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 24;
const narrowTabClass = (active: boolean) =>
  `inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] border px-1.5 font-mono text-[11px] ${
    active ? 'border-accent/40 bg-accent-soft text-accent' : 'border-edge text-muted hover:border-edge-bright hover:text-fg'
  }`;
const viewTabClass = (active: boolean) => `inline-flex h-11 cursor-pointer items-center gap-2 border-b-2 px-2 font-mono text-sm font-semibold transition-colors sm:px-4 ${
  active ? 'border-accent text-accent' : 'border-transparent text-muted hover:bg-raised hover:text-fg'}`;

export interface EditorArtifact {
  document?: DocumentGraph;
  id: string;
  version: number;
  edit_id: string;
  title: string | null;
  theme: string | null;
  template: string | null;
  colorMode: string | null;
  compiledCss?: string | null;
  markup?: string | null;
  refs?: Array<{ id: string; kind: string; title?: string | null }>;
  dataflow?: StoryIslandDataflow | null;
}

export interface InPlaceEditorProps {
  art: EditorArtifact;
  backend: ArtifactBackend;
  runtimeRef: DocumentRuntimeRef;
  sessionNonce: string | null;
  /** Where the editor publishes its drain; the page empties it before leaving edit mode. */
  flushRef?: { current: (() => Promise<void>) | null };
  initialSelectionPath?: string | null;
  onComment?: (selection: StoryEditSelection) => void;
  rightInset?: number;
  onDone?: () => void | Promise<void>;
  onRightInsetChange?: (px: number) => void;
  commentsOpen?: boolean;
  onCommentsOpenChange?: (open: boolean) => void;
  onCommentsHost?: (host: HTMLElement | null) => void;
  /** Breadcrumb slot owned by the page; without one, the title lives in document settings. */
  titleHost?: HTMLElement | null;
  /** The page owns sharing authority and supplies its controls. */
  sharingContent?: () => JSX.Element;
  onPwaEnabledChange?: (enabled: boolean) => void;
  /** The editor's bar is drawn (the page's entry skeleton gives way to it). */
  onEditorMount?: () => void;
  /** The document is editable, or shown in a view that needs no editing session (code, a preview). */
  onEditorReady?: () => void;
  /** The name the title field shows (the typed title, else the first heading): the breadcrumb's once editing ends. */
  onTitleChange?: (title: string) => void;
}

export default function InPlaceEditor(props: InPlaceEditorProps): JSX.Element {
  const art = props.art;
  const backend = props.backend;
  const runtimeRef = props.runtimeRef;
  /**
   * The title someone TYPED (null until they do, when the document has none): what the field saves. The field
   * shows what the reader's breadcrumb shows (lib/story/document/title `displayTitle`) — the typed title, else the
   * document's first heading, following it as it is edited — so edit mode names the document as reading did.
   */
  const [title, setTitle] = createSignal<string | null>(art.title?.trim() ? art.title : null);
  const shownTitle = () => title() ?? firstHeadingTitle(source()) ?? '';
  createEffect(() => props.onTitleChange?.(shownTitle()));
  const [theme, setTheme] = createSignal<StoryThemeName | null>((art.theme as StoryThemeName) ?? null);
  const [colorMode, setColorMode] = createSignal<'light' | 'dark' | null>(art.colorMode === 'dark' ? 'dark' : art.colorMode === 'light' ? 'light' : null);
  const pwaEnabled = () => readPwaSettings(source()).enabled === true;
  createEffect(() => {
    props.onPwaEnabledChange?.(pwaEnabled());
    if (!pwaEnabled() && contentView() === 'pwa') setContentView('sharing');
  });
  let previewEditId = art.edit_id;
  const viewKey = `artifactbin:editor-view:${art.id}`;
  const [mode, setMode] = createSignal<'design' | 'code'>((() => {
    try { return window.location.hash === '#edit' && window.sessionStorage.getItem(viewKey) === 'code' ? 'code' : 'design'; }
    catch { return 'design'; }
  })());
  const chooseMode = (next: 'design' | 'code') => {
    setMode(next);
    try { window.sessionStorage.setItem(viewKey, next); } catch { /* storage can be unavailable */ }
  };
  onMount(() => {
    const clearOnExit = () => {
      if (window.location.hash !== '#edit') { try { window.sessionStorage.removeItem(viewKey); } catch { /* unavailable */ } }
    };
    window.addEventListener('hashchange', clearOnExit);
    onCleanup(() => window.removeEventListener('hashchange', clearOnExit));
  });
  const [dataflowState, setDataflowState] = createSignal<DataflowState | null>(art.dataflow?.state ?? null);
  const [imageError, setImageError] = createSignal<string | null>(null);
  const [contentView, setContentView] = createSignal<'data' | 'files' | 'sharing' | 'pwa' | null>(null);
  const queriesOpen = () => contentView() === 'data';
  const [queryFocus, setQueryFocus] = createSignal<string | null>(null);
  const [dataflowPending, setDataflowPending] = createSignal(false);
  const [preview, setPreview] = createSignal<ArtifactVersionSnapshot | null>(null);
  const wide = createWideEditViewport();
  const commentsTab = () => !!props.onCommentsOpenChange;
  const [panelTab, setPanelTab] = createSignal<EditPanelTab>(props.commentsOpen && props.onCommentsOpenChange ? 'comments' : 'selection');
  const [collapsed, setCollapsedState] = createSignal(!(props.commentsOpen && props.onCommentsOpenChange) && readEditPanelCollapsed());
  const setCollapsed = (next: boolean) => { setCollapsedState(next); writeEditPanelCollapsed(next); };
  const [sheet, setSheet] = createSignal<'selection' | 'history' | null>(null);

  const [markdownDraft, setMarkdownDraft] = createSignal<string | null>(null);
  const [discardDraft, setDiscardDraft] = createSignal(false);
  const [rejectedFragment, setRejectedFragment] = createSignal<string | null>(null);
  const [historyError, setHistoryError] = createSignal<string | null>(null);
  const phone = createIsPhoneViewport();
  const barTop = () => (phone() ? 0 : APP_BAR_H);
  const barH = EDIT_BAR_H;
  let compiledFlow = art.dataflow?.flow ?? null;
  const surfaceMode = () => colorMode() ?? storyThemeDefaultMode(theme()) ?? 'light';

  /** Show a version of the document in the adopted runtime WITHOUT replacing it, in the theme and mode shown now. */
  const showInDocument = createEditDraftSender(runtimeRef, {
    editId: () => previewEditId, theme: () => untrack(theme), colorMode: () => untrack(surfaceMode),
  });

  let edit: InPlaceEditController | null = null;
  /** The source, its history, and the only ways to change them (solid/editor/create-editor-source). */
  const editorSource = createEditorSource({
    initial: art.markup ?? '',
    live: { queue: (change) => live.queue(change) },
    draw: (next, editId) => { if (editId !== undefined) previewEditId = editId; showInDocument(next); },
    commitPending: async () => { await edit?.commitPending(); },
  });
  const source = editorSource.source;
  const commitStructural = (next: string) => editorSource.apply(next, { origin: 'structural', redraw: true });

  const live = createLiveEdits({
    backend,
    initialEditId: art.edit_id,
    initialVersion: art.version,
    initialDocument: art.document,
    initialMetadata: { title: art.title, theme: art.theme, template: art.template, colorMode: art.colorMode },
    initialSource: art.markup ?? '',
    onRemoteDocument: (next, editId) => editorSource.replaceFromRemote(next, editId),
    isUserEditing: () => edit?.isUserEditing() ?? false,
  });
  const queue = live.queue;
  createEffect(() => { previewEditId = live.state.editId; });

  const applyHistory = async (direction: 'undo' | 'redo') => {
    const result = await editorSource[direction]();
    if (!result.ok) {
      if (result.reason === 'unavailable') setHistoryError(result.message);
      if (result.reason === 'conflict') setHistoryError('Undo is blocked because this content changed elsewhere. Your current document is preserved.');
      return;
    }
    setHistoryError(null);
    if (result.bookmark) edit?.restoreSelection(result.bookmark);
  };
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || !['z', 'y'].includes(event.key.toLowerCase())) return;
      const target = (event.composedPath()[0] ?? event.target) as HTMLElement;
      if (target.closest?.('input,textarea')) return;
      event.preventDefault();
      event.stopPropagation();
      void applyHistory(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', onKey, true);
    onCleanup(() => window.removeEventListener('keydown', onKey, true));
  });

  let imageDoors: { dropped: (file: File, where?: ImageDropPlacement) => void; pick: (bodyPath: string) => void } | null = null;
  const inPlace = createInPlaceEdit({
    get runtimeRef() { return runtimeRef; },
    get sessionNonce() { return props.sessionNonce; },
    onError: setHistoryError,
    onRejectedEdit: setRejectedFragment,
    onHistory: (direction) => { void applyHistory(direction); },
    onImageDrop: (file, where) => imageDoors?.dropped(file, where),
    onImageReplaceRequest: (path) => imageDoors?.pick(path),
    get editing() { return mode() === 'design' && !preview(); },
    sourceRef: { get current() { return editorSource.current(); } },
    onSourceEdited: (next, render = false, group, selection) => {
      editorSource.apply(next, { origin: 'local', group, selection, redraw: render });
    },
    onSlideTitle: (path, title) => {
      commitStructural(updateSlideTitleInJsx(editorSource.current(), bodyPathToSourcePath(editorSource.current(), path), title));
    },
    onEditKey: (key, selection) => {
      if (key === 'Escape') { edit?.select(null); return; }
      if (!selection) return;
      commitStructural(removeJsxNodeAtPath(editorSource.current(), bodyPathToSourcePath(editorSource.current(), selection.path)));
    },
  });
  edit = inPlace;

  createEffect(() => {
    if (inPlace.ready() && props.initialSelectionPath) inPlace.select(props.initialSelectionPath);
  });
  onMount(() => props.onEditorMount?.());
  createEffect(() => { if (inPlace.ready() || mode() !== 'design' || preview()) props.onEditorReady?.(); });

  // ⌘⌥M: comment on what the editor has selected.
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!props.onComment || event.key.toLowerCase() !== 'm' || !event.altKey || !(event.metaKey || event.ctrlKey)) return;
      const current = inPlace.selection();
      if (!current) return;
      event.preventDefault();
      props.onComment(current);
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  // Changes from elsewhere (an agent, another person) while we are editing.
  const remote = createLiveArtifact({ backend, id: art.id, initialEditId: art.edit_id, initialVersion: art.version, enabled: typeof EventSource === 'function', isOwnFrame: (id) => live.isOwnEdit(id) });
  createEffect(() => {
    const frame = remote();
    if (!frame || frame.format !== 'markup' || typeof frame.source !== 'string') return;
    const state = live.state;
    if (frame.version <= state.version || frame.editId === state.editId) return;
    void state.pending;
    let timer: number | null = null;
    let adopted = false;
    const attempt = () => {
      if (!live.adoptRemote(frame.editId, frame.source!, frame.by, frame.document, frame.version,
        { title: frame.title, theme: frame.theme, template: frame.template, colorMode: frame.colorMode })) return;
      adopted = true;
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      inPlace.select(null);
    };
    untrack(attempt);
    if (!adopted) timer = window.setInterval(attempt, 250);
    onCleanup(() => { if (timer !== null) window.clearInterval(timer); });
  });

  // ── draft data ──
  const flowSignature = createMemo(() => storyUpdateParts(source())?.declarations ?? null);
  const initialFlowSignature = storyUpdateParts(art.markup ?? '')?.declarations ?? null;
  const hasDeclarations = (signature: string): boolean => {
    const groups = JSON.parse(signature) as Record<string, unknown>;
    return Object.values(groups).some((value) => Array.isArray(value) && value.length > 0);
  };
  let ranSignature: string | null = art.dataflow?.state || (initialFlowSignature !== null && !hasDeclarations(initialFlowSignature)) ? initialFlowSignature : null;
  const queriesUnavailable = backend.unavailable('runQueries');
  createEffect(() => {
    const signature = flowSignature();
    if (signature === null || signature === ranSignature) return;
    if (!hasDeclarations(signature)) { ranSignature = signature; return; }
    if (queriesUnavailable) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      ranSignature = signature;
      setDataflowPending(true);
      void backend.previewQueries(editorSource.current()).then((body) => {
        if (!alive) return;
        setDataflowPending(false);
        if (!body) return;
        const next = { values: {}, tables: body.tables, errors: body.errors };
        compiledFlow = body.flow ?? null;
        setDataflowState(next);
      }).catch(() => { if (alive) setDataflowPending(false); });
    }, 400);
    onCleanup(() => { alive = false; window.clearTimeout(timer); });
  });

  // ── leaving ──
  const leave = async () => {
    try { await inPlace.commitPending(); } catch (error) { setHistoryError(error instanceof Error ? error.message : 'Editor is unavailable.'); return; }
    await live.flushNow();
  };
  useBeforeLeave((event) => {
    if (event.defaultPrevented || live.isIdle()) return;
    event.preventDefault();
    void live.flushForNavigation(() => inPlace.commitPending(true)).then((ok) => { if (ok) event.retry(true); });
  });
  if (props.flushRef) {
    const flushRef = props.flushRef;
    flushRef.current = leave;
    onCleanup(() => { if (flushRef.current === leave) flushRef.current = null; });
  }
  onMount(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void leave(); };
    document.addEventListener('visibilitychange', onHide);
    onCleanup(() => document.removeEventListener('visibilitychange', onHide));
  });

  // ── embeds ──
  const selection = inPlace.selection;
  const embedPath = createMemo(() => { const s = selection(); return s?.kind === 'embed' ? bodyPathToSourcePath(source(), s.path) : null; });
  const chart = createMemo(() => { const p = embedPath(); return p && selection()?.tag === 'Question' ? readQuestionChart(source(), p) : null; });
  const numberEmbed = createMemo(() => { const p = embedPath(); return p && selection()?.tag === 'Number' ? readNumberEmbed(source(), p) : null; });
  const mermaidEmbed = createMemo(() => { const p = embedPath(); return p && selection()?.tag === 'Mermaid' ? readMermaidEmbed(source(), p) : null; });
  const inspector = createMemo(() => (chart() ? 'chart' : numberEmbed() ? 'number' : mermaidEmbed() ? 'diagram' : null) as 'chart' | 'number' | 'diagram' | null);
  const tables = createMemo(() => tableChoices(source(), dataflowState()));
  const queryNotebook = createMemo(() => queryCells(source(), dataflowState(), dataflowPending(), compiledFlow));
  const onChartChange = (next: { viz: unknown; table: string | null }) => {
    const p = embedPath(); if (!p) return;
    commitStructural(updateQuestionChartInJsx(editorSource.current(), p, { viz: next.viz as VizEnvelopeValue | undefined, table: next.table }));
  };
  const onChartTitleChange = (next: string | null) => { const p = embedPath(); if (p) commitStructural(updateQuestionTitleInJsx(editorSource.current(), p, next)); };
  const onNumberChange = (next: NumberEmbedEdit) => { const p = embedPath(); if (p) commitStructural(updateNumberEmbedInJsx(editorSource.current(), p, next)); };
  const onMermaidChange = (next: MermaidEmbedEdit) => { const p = embedPath(); if (p) commitStructural(updateMermaidEmbedInJsx(editorSource.current(), p, next)); };
  const onQuerySqlChange = (name: string, sql: string) => commitStructural(updateQuerySqlInJsx(editorSource.current(), name, sql));
  const notebookVisible = () => queriesOpen() && !inspector() && mode() === 'design' && !preview() && queryNotebook().length > 0;
  createEffect(() => {
    if (notebookVisible()) return;
    inPlace.spotlight([]);
    setQueryFocus(null);
  });
  const appView = () => mode() === 'design' && contentView() === null;
  const panelWidth = () => (wide() && appView() ? editPanelWidth(collapsed()) : 0);
  createEffect(() => {
    if (appView()) return;
    setSheet(null);
    if (untrack(() => props.commentsOpen)) props.onCommentsOpenChange?.(false);
  });
  createEffect(() => props.onRightInsetChange?.(panelWidth()));
  onCleanup(() => props.onRightInsetChange?.(0));

  createEffect(on(() => props.commentsOpen, (open) => {
    if (!commentsTab()) return;
    if (open) {
      setPanelTab('comments');
      setSheet(null);
      if (untrack(collapsed)) { writeEditPanelCollapsed(false); setCollapsedState(false); }
    } else setPanelTab((current) => (current === 'comments' ? 'selection' : current));
  }));
  const chooseTab = (next: EditPanelTab) => {
    if (collapsed()) setCollapsed(false);
    setPanelTab(next);
    if (next === 'comments') props.onCommentsOpenChange?.(true);
    else if (props.commentsOpen) props.onCommentsOpenChange?.(false);
  };
  const selectionDot = () => panelTab() !== 'selection' && inspector() !== null && mode() === 'design' && !preview();

  const revealAboveSheet = () => {
    const rect = selection()?.rect;
    if (!rect) return;
    const top = barTop() + barH + 8;
    if (rect.y >= top && rect.y + rect.height <= window.innerHeight / 2) return;
    window.scrollBy({ top: rect.y - top, behavior: 'smooth' });
  };
  const openSheet = (next: 'selection' | 'history' | null) => {
    if (next && props.commentsOpen) props.onCommentsOpenChange?.(false);
    const reveal = next === 'selection' && sheet() !== 'selection';
    setSheet(next);
    if (reveal) revealAboveSheet();
  };
  const inspectSelection = () => { if (wide()) chooseTab('selection'); else openSheet('selection'); };

  // Double-click (or double-tap) on the selected embed opens its inspector.
  onMount(() => {
    let lastTap = { at: -Infinity, x: 0, y: 0 };
    let touchOpenedAt = -Infinity;
    const hit = (event: MouseEvent) => {
      const rect = selection()?.rect;
      if (!inspector() || !rect) return false;
      const target = event.target as Element | null;
      if (!target?.closest?.('[aria-label="Artifact viewport"]')) return false;
      const { clientX: x, clientY: y } = event;
      return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
    };
    const onDoubleClick = (event: MouseEvent) => { if (event.timeStamp - touchOpenedAt < 1000) return; if (hit(event)) inspectSelection(); };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      const near = Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= DOUBLE_TAP_PX;
      if (event.timeStamp - lastTap.at <= DOUBLE_TAP_MS && near) {
        lastTap = { at: -Infinity, x: 0, y: 0 };
        if (hit(event)) { touchOpenedAt = event.timeStamp; inspectSelection(); }
        return;
      }
      lastTap = { at: event.timeStamp, x: event.clientX, y: event.clientY };
    };
    window.addEventListener('dblclick', onDoubleClick, true);
    window.addEventListener('pointerup', onPointerUp, true);
    onCleanup(() => { window.removeEventListener('dblclick', onDoubleClick, true); window.removeEventListener('pointerup', onPointerUp, true); });
  });
  const onOpenQuery = (name: string) => { inPlace.select(null); setQueryFocus(name); setContentView('data'); };
  const deleteSelected = () => {
    const s = selection(); if (!s) return;
    commitStructural(removeJsxNodeAtPath(editorSource.current(), bodyPathToSourcePath(editorSource.current(), s.path)));
    inPlace.select(null);
  };

  // ── images ──
  const [imageMenuOpen, setImageMenuOpen] = createSignal(false);
  const [imageDialog, setImageDialog] = createSignal<{ mode: 'insert'; anchor: JsxInsertAnchor | null } | { mode: 'replace'; target: JsxImageTarget } | null>(null);
  const importImageUrl = (url: string): Promise<ImageChoice> => backend.importImage({ imageUrl: url });
  const uploadImage = (file: File): Promise<ImageChoice> => backend.importImage({ file, name: file.name });
  const drainTyping = async (): Promise<boolean> => {
    try { await inPlace.commitPending(); return true; }
    catch (error) { setImageError(error instanceof Error ? error.message : 'Could not change the document.'); return false; }
  };
  const anchorAt = (bodyPath: string | null | undefined): JsxInsertAnchor | null =>
    bodyPath ? nodeTargetInJsx(editorSource.current(), bodyPathToSourcePath(editorSource.current(), bodyPath)) : null;
  const insertImage = async (anchor: JsxInsertAnchor | null, image: ChosenImage) => {
    if (!(await drainTyping())) return;
    const nodeId = freshNodeId(editorSource.current());
    const placed = placeImageInJsx(editorSource.current(), image.id, anchor, { nodeId });
    if (placed.source === editorSource.current() || !placed.path) return;
    commitStructural(placed.source);
    const bodyPath = sourcePathToBodyPath(placed.source, placed.path);
    if (bodyPath) inPlace.select(bodyPath, { reveal: true, nodeId });
  };
  const replaceImage = async (target: JsxImageTarget, image: ChosenImage) => {
    if (!(await drainTyping())) return;
    const next = replaceImageSrcInJsx(editorSource.current(), target, image.id);
    if (next === editorSource.current()) { setImageError('That image changed while the new one was uploading. Select it and try again.'); return; }
    commitStructural(next);
  };
  const imageTargetAt = (bodyPath: string) => imageTargetInJsx(editorSource.current(), bodyPathToSourcePath(editorSource.current(), bodyPath));
  const uploadOrSay = async (file: File): Promise<ChosenImage | null> => {
    if (!file.type.startsWith('image/')) return null;
    setImageError(null);
    const result = await uploadImage(file);
    if (!result.ok) setImageError(result.error);
    return result.ok ? result.image : null;
  };
  let replaceInput: HTMLInputElement | undefined;
  let replacePick: JsxImageTarget | null = null;
  imageDoors = {
    dropped: (file, where) => {
      if (where?.replace) {
        const target = imageTargetAt(where.replace);
        if (!target) return;
        void uploadOrSay(file).then((image) => image && replaceImage(target, image));
        return;
      }
      const anchor = where && 'at' in where
        ? (where.at ? { ...(anchorAt(where.at.path) ?? { path: '' }), side: where.at.side } : null)
        : anchorAt(selection()?.path);
      void uploadOrSay(file).then((image) => image && insertImage(anchor?.path ? anchor : null, image));
    },
    pick: (bodyPath) => {
      replacePick = imageTargetAt(bodyPath);
      if (replacePick) replaceInput?.click();
    },
  };
  const openInsertDialog = () => { setImageMenuOpen(false); setImageDialog({ mode: 'insert', anchor: anchorAt(selection()?.path) }); };
  const selectedImagePath = () => (selection()?.tag === 'img' ? selection()!.path : null);
  const imageControls = () => {
    const path = selectedImagePath();
    if (!path) return undefined;
    return {
      alt: imageAltInJsx(source(), { path: bodyPathToSourcePath(source(), path) }),
      onReplace: () => { const target = imageTargetAt(path); if (target) setImageDialog({ mode: 'replace', target }); },
      onAlt: (alt: string) => commitStructural(setImageAltInJsx(editorSource.current(), { path: bodyPathToSourcePath(editorSource.current(), path) }, alt)),
    };
  };

  // ── version history ──
  const history = createArtifactVersions({ backend, get currentVersion() { return live.state.version; } });
  const historyUnavailable = backend.unavailable('versions');
  const previewVersion = async (v: number) => {
    const snapshot = await history.fetchVersion(v);
    if (!snapshot) return;
    // The version first, then editing pauses: the controller draws it instead of returning to the saved head.
    // The version's content in the page's current design: the page around it keeps its theme and mode.
    showInDocument(snapshot.markup ?? '', { preview: true });
    setPreview(snapshot);
    inPlace.select(null);
  };
  const backToCurrent = () => { setPreview(null); showInDocument(editorSource.current()); };
  const restoreVersion = async (v: number) => {
    let next: number | null;
    try { next = await history.restore(v); } catch (error) { setHistoryError(error instanceof Error ? error.message : 'Could not restore that version.'); return; }
    if (next === null) return;
    setPreview(null);
    await history.refresh();
  };

    const { canUndo, canRedo } = editorSource;
  const historyControls = () => <>
    <Tooltip content="Undo (Ctrl/Cmd Z)">
      <button type="button" aria-label="Undo" disabled={!canUndo()} onMouseDown={(e) => e.preventDefault()} onClick={() => void applyHistory('undo')}
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-fg disabled:opacity-30"><Undo2 size={14} /></button>
    </Tooltip>
    <Tooltip content="Redo (Ctrl/Cmd Shift Z)">
      <button type="button" aria-label="Redo" disabled={!canRedo()} onMouseDown={(e) => e.preventDefault()} onClick={() => void applyHistory('redo')}
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-fg disabled:opacity-30"><Redo2 size={14} /></button>
    </Tooltip>
  </>;
  const insertionControls = () => (
    <StoryToolbarMenu label={wide() ? 'Insert' : '+'} name="Insert" open={imageMenuOpen()} onOpenChange={setImageMenuOpen}>
      <div class="flex w-44 flex-col">
        <button type="button" onClick={openInsertDialog} class="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-raised">Image…</button>
        <button type="button" aria-label="Paste Markdown" onClick={() => { setImageMenuOpen(false); setMarkdownDraft(''); }}
          class="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-raised">Paste Markdown</button>
      </div>
    </StoryToolbarMenu>
  );

  const inspectable = () => !!inspector() && mode() === 'design' && !preview();
  const inspectorBody = () => {
    const kind = inspector();
    if (!kind || mode() !== 'design' || preview()) return null;
    return <section aria-label={INSPECTOR_LABEL[kind]}>
      <div class="mb-3 flex items-center justify-between">
        <span class="font-mono text-[11px] uppercase tracking-wide text-faint">{kind}</span>
        <Show when={wide()}>
          <button type="button" aria-label={`Close ${INSPECTOR_LABEL[kind].toLowerCase()}`} onClick={() => inPlace.select(null)} class="cursor-pointer font-mono text-[11px] text-muted hover:text-fg">close</button>
        </Show>
      </div>
      <Show when={chart()} fallback={<Show when={numberEmbed()} fallback={<Show when={mermaidEmbed()}>{(embed) => <MermaidEditorPanel embed={embed()} onChange={onMermaidChange} />}</Show>}>
        {(binding) => <NumberEditorPanel binding={binding()} tables={tables()} onChange={onNumberChange} onOpenQuery={onOpenQuery} />}
      </Show>}>
        {(c) => <VizEditorPanel viz={c().viz} title={c().title} table={c().table} tables={tables()} onChange={onChartChange} onTitleChange={onChartTitleChange} onOpenQuery={onOpenQuery} />}
      </Show>
    </section>;
  };
  const formatBackend = { mentionsUnavailable: backend.unavailable('mentions'), members: (query: string, opts: { signal: AbortSignal }) => backend.members(query, opts).then((r) => (r ? { people: r.people ?? [] } : null)) };
  const formatControls = () => {
    const s = selection();
    if (!s || mode() !== 'design' || preview() || contentView() !== null) return null;
    return <StoryFormatToolbar layout="panel" artifactId={art.id} selection={s} onApply={inPlace.applyFormat} onApplyLink={inPlace.applyLink} onApplyInline={inPlace.applyInline}
      onAutoHeight={() => commitStructural(editBlock(editorSource.current(), { kind: 'auto-height', path: s.path }))}
      onSelect={inPlace.select} onDelete={deleteSelected} onComment={props.onComment} image={imageControls()} backend={formatBackend} />;
  };
  const titleEditor = () => (
    <input aria-label="Title" value={shownTitle()} placeholder="untitled"
      onInput={(e) => { setTitle(e.currentTarget.value); queue({ title: e.currentTarget.value }); }}
      style={{ width: `calc(${Math.max(9, Math.min(shownTitle().length + 2, 64))}ch + 14px)`, 'max-width': '100%' }}
      class="min-w-0 text-ellipsis rounded-[4px] border border-transparent bg-transparent px-1.5 py-1 font-mono text-xs font-semibold text-fg hover:border-edge focus:border-edge-bright focus:outline-none" />
  );
  const selectionBody = () => <>
    <section aria-label="Document appearance" class="flex flex-col items-start gap-2 px-1 py-2">
      <h3 class="mb-1 font-mono text-[11px] uppercase tracking-wide text-faint">Document</h3>
      <Show when={!props.titleHost}>{titleEditor()}</Show>
      <ThemePicker value={theme()} colorMode={colorMode()} onPick={(t) => {
        setTheme(t);
        queue({ theme: t });
        showInDocument(editorSource.current());
      }} />
      <TemplateChip template={art.template} />
      <ModeChip mode={colorMode()} themeDefault={storyThemeDefaultMode(theme()) ?? 'light'} onPick={(next) => {
        setColorMode(next);
        queue({ colorMode: next });
        showInDocument(editorSource.current());
      }} />
    </section>
    <hr class="my-3 border-edge" />
    {formatControls()}
    <Show when={inspectorBody()} fallback={<Show when={!formatControls()}><p class="px-1 py-2 font-sans text-xs text-muted">{SELECTION_HINT}</p></Show>}>
      {(body) => <div class="mt-3">{body()}</div>}
    </Show>
  </>;
  const versionHistory = (extra: { embedded?: boolean; sheet?: boolean; onClose: () => void }) => (
    <VersionHistory {...extra} topOffset={barTop() + barH} versions={history.versions()} currentVersion={live.state.version}
      previewing={preview()?.version ?? null} onPreview={(v) => void previewVersion(v)} onRestore={(v) => void restoreVersion(v)}
      onBackToCurrent={backToCurrent} busy={history.busy()} />
  );
  const viewTabs = (): Array<{ key: string; label: string; aria: string; tip: string; icon: JSX.Element; active: boolean; choose: () => void }> => [
    { key: 'design', label: 'App', aria: 'Edit on the page', tip: 'edit on the page', icon: <Paintbrush size={12} />, active: mode() === 'design' && contentView() === null, choose: () => { chooseMode('design'); setContentView(null); } },
    { key: 'code', label: 'Code', aria: 'Edit the source', tip: 'edit the source', icon: <Code size={12} />, active: mode() === 'code', choose: () => { chooseMode('code'); setContentView(null); } },
    ...(queryNotebook().length > 0 ? [{ key: 'data', label: 'Data', aria: 'Show data', tip: "the document's queries", icon: <Database size={12} />, active: queriesOpen(), choose: () => { const was = queriesOpen(); setContentView('data'); chooseMode('design'); if (!was) inPlace.select(null); } }] : []),
    ...(pwaEnabled() ? [{ key: 'pwa', label: 'PWA', aria: 'Show PWA settings', tip: 'PWA settings', icon: <Smartphone size={12} />, active: contentView() === 'pwa', choose: async () => { if (await live.flushForNavigation(() => inPlace.commitPending(true))) { setContentView('pwa'); chooseMode('design'); inPlace.select(null); } } }] : []),
    ...((art.refs ?? []).some(ref => ref.kind !== 'dataset') ? [{ key: 'files', label: 'Files', aria: 'Show files', tip: 'Files', icon: <Files size={12} />, active: contentView() === 'files', choose: () => { setContentView('files'); chooseMode('design'); inPlace.select(null); } }] : []),
    ...(props.sharingContent ? [{ key: 'sharing', label: 'Sharing', aria: 'Show sharing', tip: 'Sharing', icon: <Share2 size={12} />, active: contentView() === 'sharing', choose: () => { setContentView('sharing'); chooseMode('design'); inPlace.select(null); } }] : []),
  ];
  const InspectIcon = (p: { size: number; class?: string }) => {
    const kind = inspector();
    if (!kind) return null;
    const Icon = INSPECT_ICON[kind];
    return <Icon size={p.size} class={p.class} />;
  };

  return (
    <div class="contents" data-app-appearance={surfaceMode()}>
      <Show when={props.titleHost}>{(host) => <Portal mount={host()}>{titleEditor()}</Portal>}</Show>
      <input ref={replaceInput} type="file" accept={IMAGE_ACCEPT} aria-label="Replacement image file" class="hidden" onChange={(e) => {
        const f = e.currentTarget.files?.[0];
        const target = replacePick;
        replacePick = null;
        e.currentTarget.value = '';
        if (f && target) void uploadOrSay(f).then((image) => image && replaceImage(target, image));
      }} />
      <Show when={imageDialog()}>{(open) => (
        <ImageDialog mode={open().mode} onUploadFile={uploadImage} onImportUrl={importImageUrl} onClose={() => setImageDialog(null)}
          unavailable={backend.unavailable('webAssets')}
          onConfirm={(image) => {
            const current = open();
            setImageDialog(null);
            if (current.mode === 'insert') void insertImage(current.anchor, image);
            else void replaceImage(current.target, image);
          }} />
      )}</Show>
      <Show when={markdownDraft() !== null}>
        <MarkdownPasteDialog value={markdownDraft() ?? ''} onChange={setMarkdownDraft} onClose={() => setMarkdownDraft(null)}
          onInsert={() => { inPlace.pasteMarkdown(markdownDraft() ?? ''); setMarkdownDraft(null); }} />
      </Show>
      <Show when={live.state.status.startsWith('not saved')}>
        <div role="alert" class="fixed bottom-4 right-4 z-50 max-w-md rounded border border-edge bg-surface p-3 text-sm">
          <p>{live.state.status}</p>
          <div class="mt-2 flex flex-wrap gap-3">
            <button type="button" onClick={() => void live.recover('retry')}>Retry save</button>
            <button type="button" onClick={() => void copyText(editorSource.current()).then((ok) => { if (!ok) setHistoryError('Could not copy. Open the source editor to select and copy your draft.'); })}>Copy draft</button>
            <button type="button" onClick={() => setDiscardDraft(true)}>Use server version</button>
          </div>
          <Show when={discardDraft()}>
            <div role="alertdialog" aria-label="Discard unsaved draft" class="mt-3 border-t border-edge pt-3">
              <p>Replace your unsaved draft with the server version? Copy your draft first if you want to keep it.</p>
              <button type="button" onClick={() => { setDiscardDraft(false); void live.recover('server'); }}>Discard draft and load server</button>
              <button type="button" onClick={() => setDiscardDraft(false)}>Keep editing</button>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={rejectedFragment() !== null}>
        <div role="alertdialog" aria-label="Recover uncommitted text" class="fixed inset-x-4 top-28 z-50 mx-auto max-w-xl rounded border border-edge bg-surface p-4 shadow-xl">
          <p>This text could not be applied to the current document. Copy it before restoring the document.</p>
          <textarea aria-label="Uncommitted text" readOnly value={rejectedFragment() ?? ''} class="mt-2 h-32 w-full font-mono text-sm" />
          <button type="button" onClick={() => void copyText(rejectedFragment() ?? '').then((ok) => { if (!ok) setHistoryError('Select and copy the text from the field.'); })}>Copy uncommitted text</button>
          <button type="button" onClick={() => { inPlace.discardRejectedEdit(); setRejectedFragment(null); showInDocument(editorSource.current()); }}>Discard this text and restore document</button>
        </div>
      </Show>
      <Show when={historyError()}>
        <div role="alert" class="fixed bottom-4 left-4 z-50 rounded border border-edge bg-surface p-3 text-sm">
          {historyError()}
          <button type="button" onClick={() => setHistoryError(null)} aria-label="Dismiss undo message">{' '}×</button>
        </div>
      </Show>
      <header aria-label="Editor toolbar"
        class="fixed z-30 grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[44px] items-center gap-x-1 border-b border-edge bg-surface px-2 sm:gap-x-2 sm:px-3"
        style={{ top: `${barTop()}px`, height: `${barH}px`, left: '0px', right: `${props.rightInset ?? 0}px` }}>
        <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:gap-2">
          <div role="tablist" aria-label="Editor view" class="flex h-11 shrink-0 items-stretch sm:gap-1" onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
            const current = tabs.indexOf(event.target as HTMLButtonElement);
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            event.preventDefault();
            tabs[index]?.focus();
            tabs[index]?.click();
          }}>
            <For each={viewTabs()}>{(tab) => (
              <Tooltip content={tab.tip}>
                <button type="button" role="tab" aria-label={tab.aria} aria-selected={tab.active} tabIndex={tab.active ? 0 : -1} onClick={() => tab.choose()} class={viewTabClass(tab.active)}>
                  {tab.icon}<span class="hidden sm:inline">{tab.label}</span>
                </button>
              </Tooltip>
            )}</For>
          </div>
        </div>
        <div aria-label="Document actions" class="flex shrink-0 items-center sm:gap-2">
          <span role="status" class="hidden text-xs text-muted lg:inline">{live.state.status || (live.state.pending ? 'Saving…' : `v${live.state.version} · Saved`)}</span>
          <Show when={wide() && appView() && inspectable() && inspector()}>{(kind) => (
            <Tooltip content={`${INSPECT_LABEL[kind()]} settings`}>
              <button type="button" aria-label={INSPECT_LABEL[kind()]} onClick={inspectSelection}
                class="inline-flex h-6 cursor-pointer items-center gap-1 rounded-[4px] border border-edge px-1.5 font-mono text-[11px] text-muted hover:border-edge-bright hover:text-fg">
                <InspectIcon size={12} class="shrink-0" /><span class="hidden lg:inline">{INSPECT_LABEL[kind()]}</span>
              </button>
            </Tooltip>
          )}</Show>
          <Show when={!wide() && appView()}>
            <Tooltip content={inspectable() && inspector() ? `${INSPECT_LABEL[inspector()!]} settings` : 'selection settings'}>
              <button type="button" aria-label={inspectable() && inspector() ? INSPECT_LABEL[inspector()!] : 'Show selection settings'} aria-expanded={sheet() === 'selection'}
                onClick={() => openSheet(sheet() === 'selection' ? null : 'selection')} class={narrowTabClass(sheet() === 'selection')}>
                <Show when={inspectable()} fallback={<SlidersHorizontal size={12} class="shrink-0" />}><InspectIcon size={12} class="shrink-0" /></Show>
              </button>
            </Tooltip>
            <FeatureGate reason={historyUnavailable}>
              {(gate) => {
                const button = <button type="button" aria-label="Open version history" aria-expanded={sheet() === 'history'} disabled={gate.disabled} aria-describedby={gate['aria-describedby']}
                  onClick={() => openSheet(sheet() === 'history' ? null : 'history')} class={`${narrowTabClass(sheet() === 'history')} disabled:cursor-default disabled:opacity-50`}>
                  <History size={12} class="shrink-0" />
                </button>;
                return gate.disabled ? button : <Tooltip content="version history">{button}</Tooltip>;
              }}
            </FeatureGate>
            <Show when={commentsTab()}>
              <Tooltip content="comments">
                <button type="button" aria-label="Show comments" aria-expanded={!!props.commentsOpen} onClick={() => { setSheet(null); props.onCommentsOpenChange?.(!props.commentsOpen); }} class={narrowTabClass(!!props.commentsOpen)}>
                  <MessageSquare size={12} class="shrink-0" />
                </button>
              </Tooltip>
            </Show>
          </Show>
          <Show when={appView()}>{insertionControls()}</Show>
          <Show when={appView()}><div aria-label="Editing history" class="flex items-center">{historyControls()}</div></Show>
          <Tooltip content="done editing">
            <button type="button" aria-label="Exit edit mode" onClick={(event) => {
              event.currentTarget.blur();
              try { window.sessionStorage.removeItem(viewKey); } catch { /* unavailable */ }
              void props.onDone?.();
            }} class="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[4px] border border-accent/40 bg-accent-soft px-2 font-mono text-[11px] text-accent hover:border-accent">
              <Check size={13} /><span class="hidden sm:inline">Done</span>
            </button>
          </Tooltip>
        </div>
      </header>
      <Show when={imageError()}>
        <div aria-label="Image upload error" class="fixed z-30 flex items-center justify-between gap-3 border-b border-red-300 bg-red-50 px-4 py-1.5 font-mono text-[11px] text-red-800"
          style={{ top: `${barTop() + barH}px`, left: '0px', right: `${panelWidth()}px` }}>
          <span>{imageError()}</span>
          <button type="button" aria-label="Dismiss image error" onClick={() => setImageError(null)} class="cursor-pointer rounded border border-red-300 px-2 py-0.5 hover:bg-red-100">dismiss</button>
        </div>
      </Show>
      <Show when={mode() === 'code'}>
        <div class="fixed bottom-0 z-20" style={{ top: `${barTop() + barH}px`, left: '0px', right: `${panelWidth()}px` }} aria-label="Source pane">
          <SourceEditorPane value={source()} revision={editorSource.revision()} onChange={(text) => editorSource.apply(text, { origin: 'local' })} />
        </div>
      </Show>
      <Show when={wide() && appView()}>
        <EditPanel top={barTop() + barH} tab={panelTab()} onTab={chooseTab} collapsed={collapsed()} onCollapsedChange={setCollapsed}
          selectionDot={selectionDot()} commentsAvailable={commentsTab()} historyUnavailable={historyUnavailable}>
          <Show when={!collapsed()}>
            <Show when={panelTab() === 'selection'} fallback={<Show when={panelTab() === 'history'} fallback={
              <div ref={(el) => { props.onCommentsHost?.(el); onCleanup(() => props.onCommentsHost?.(null)); }} class="flex min-h-0 flex-1 flex-col" />
            }>{versionHistory({ embedded: true, onClose: () => {} })}</Show>}>
              <div class="min-h-0 flex-1 overflow-y-auto p-3">{selectionBody()}</div>
            </Show>
          </Show>
        </EditPanel>
      </Show>
      <Show when={!wide() && appView() && sheet() === 'selection'}>
        <MobileSheet label="Selection settings" size="half" swipeToClose onClose={() => setSheet(null)} header={
          <div class="flex items-center justify-between px-1 pb-2">
            <span class="font-mono text-xs font-semibold text-fg">selection</span>
            <button type="button" aria-label="Close selection settings" onClick={() => setSheet(null)} class="cursor-pointer rounded p-1 text-muted hover:text-fg"><X size={13} /></button>
          </div>
        }>{selectionBody()}</MobileSheet>
      </Show>
      <Show when={notebookVisible()}>
        <aside aria-label="Data" class="fixed bottom-0 z-20 overflow-y-auto bg-surface p-4"
          style={{ top: `${barTop() + barH}px`, left: '0px', right: '0px', 'padding-right': `${wide() ? editPanelWidth(false) + 16 : 16}px` }}>
          <QueryNotebookPanel cells={queryNotebook()} onSqlChange={onQuerySqlChange} onSpotlight={inPlace.spotlight} focus={queryFocus()} backend={backend}
            titles={Object.fromEntries((art.refs ?? []).map((r) => [r.id, r.title ?? null]))} />
        </aside>
      </Show>
      <Show when={mode() === 'design' && !preview() && contentView() === 'pwa' && pwaEnabled()}>
        <aside aria-label="PWA" class="fixed bottom-0 z-20 overflow-y-auto bg-surface p-4 sm:p-6" style={{ top: `${barTop() + barH}px`, left: '0px', right: '0px' }}>
          <PwaSettingsPanel id={art.id} title={shownTitle()} source={source()} onChange={commitStructural} onUpload={uploadImage} beforeInstall={() => live.flushForNavigation(() => inPlace.commitPending(true))} />
        </aside>
      </Show>
      <Show when={mode() === 'design' && !preview() && (contentView() === 'files' || contentView() === 'sharing')}>
        <aside aria-label={contentView() === 'files' ? 'Files' : 'Sharing settings'} class="fixed bottom-0 z-20 overflow-y-auto bg-surface p-4 sm:p-6"
          style={{ top: `${barTop() + barH}px`, left: '0px', right: `${panelWidth()}px` }}>
          <Show when={contentView() === 'files'} fallback={<div class="space-y-6">{props.sharingContent?.()}<PwaSharingSetting source={source()} onChange={commitStructural} /></div>}>
            <div class="mx-auto max-w-3xl"><ReferenceFilesPanel refs={art.refs ?? []} /></div>
          </Show>
        </aside>
      </Show>
      <Show when={!wide() && appView() && sheet() === 'history'}>
        {versionHistory({ sheet: true, onClose: () => setSheet(null) })}
      </Show>
    </div>
  );
}
