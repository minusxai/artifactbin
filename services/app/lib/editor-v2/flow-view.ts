/**
 * A continuous prose region's PROSEMIRROR view, framework-free: the schema-bound editor state,
 * key bindings, node views, AST-path decorations, the guarded transaction pipeline, paste and
 * composition handling. solid/editor/FlowEditor.tsx adapts it with onMount + one effect.
 */
import { runtimeId } from '@/lib/story-runtime/runtime-id';
import { DOMSerializer, type ResolvedPos } from 'prosemirror-model';
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list';
import { baseKeymap, chainCommands, splitBlockAs } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { serializeJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import { mergeIdentityMaps } from './annotation-map';
import { captureBookmark, type EditorSelectionChange } from './bookmark';
import { clipboardAst, type ClipboardKind } from './clipboard';
import { editorDocument, editorSchema, normalizeIdentities, pasteFragment, sourceNodes, toggleInline } from './model';

export interface FlowEditorProps {
  nodes: JsxNode[];
  /** Path of the first node in this sibling region. */
  path: string;
  onChange(nodes: JsxNode[], group?: string, selection?: EditorSelectionChange): void;
  onError?(message: string): void;
  onBusy?(busy: boolean): void;
  canEdit?(): boolean;
  onView?(view: EditorView | null): void;
}

export interface FlowView {
  readonly view: EditorView;
  /** Hand typed text to the page now (it is otherwise handed over once typing pauses: FLOW_IDLE_MS). */
  flush(): void;
  /** An IME composition is in flight: incoming source must wait (it would break the composition). */
  composing(): boolean;
  /** Adopt the source the page now holds — a no-op (bar AST paths) when it is our own echo. */
  sync(nodes: JsxNode[]): void;
  /**
   * Redraw the AST-path decorations for `path` (the props carry it from now on), the prose unchanged, in steps the
   * caller runs in order (idle slices, out of the redraw's own task): until then the view keeps its decorations.
   */
  repath(path: string): Array<() => void>;
  /** A path change the caller redraws in steps (`repath`), not the adapter at once. */
  repathing(path: string): boolean;
  destroy(): void;
}

/**
 * Mount the region into `mount`. `props` is read LIVE on every event (the adapters hand the
 * current props, never a snapshot); `onCompositionSettled` asks the adapter to sync again once
 * a composition has ended (the source may have moved underneath it).
 */
/**
 * Home/End move the caret to the start/end of the visual line. Left to the browser, macOS
 * Chromium treats them as document scroll keys and the caret stays put (typing then lands
 * mid-word), so the editor performs the line move itself with the platform's own
 * Selection.modify; the resulting DOM selection is read back by ProseMirror as usual.
 */
function moveToLineBoundary(view: EditorView, event: KeyboardEvent): boolean {
  if ((event.key !== 'Home' && event.key !== 'End') || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
  if (!(view.state.selection instanceof TextSelection)) return false;
  const selection = view.dom.ownerDocument.defaultView?.getSelection();
  if (!selection || typeof selection.modify !== 'function') return false;
  selection.modify(event.shiftKey ? 'extend' : 'move', event.key === 'Home' ? 'backward' : 'forward', 'lineboundary');
  event.preventDefault();
  return true;
}

/**
 * Typing is handed to the page once it pauses this long. The page's part of an edit (the region serialized,
 * composed into the whole source, recorded, queued) grows with the document; ProseMirror has already drawn the
 * keystroke, so none of it belongs on the keystroke's path.
 */
export const FLOW_IDLE_MS = 200;

const flushers = new WeakMap<EditorView, () => void>();
/** Hand a view's held typing to the page now: anything that reads or replaces the source first (commit, undo, a redraw). */
export function flushFlowView(view: EditorView): void { flushers.get(view)?.(); }
const repathers = new WeakMap<EditorView, (path: string) => Array<() => void>>();
/** A mounted view's path redraw in steps (`FlowView.repath`); none for a view not mounted here. */
export function repathFlowView(view: EditorView, path: string): Array<() => void> { return repathers.get(view)?.(path) ?? []; }

/**
 * MARKDOWN BLOCK SHORTCUTS. A marker typed at the start of an ordinary paragraph, then a space, turns the
 * paragraph into the structure it names: `# `..`###### ` a heading, `* `/`- ` a bullet item, `1. ` a
 * numbered item. The space is typed first, as ordinary typing (it joins the marker's undo step), and the
 * conversion is its own structural transaction — so one undo, through the source history, puts the literal
 * marker back. Never inside code, a list, a table cell or a synthetic run, never mid-prose, never while
 * composing.
 */
const BLOCK_SHORTCUT = /^(#{1,6}|[*-]|1\.)[ \u00a0]$/;

/** The block a shortcut may convert: an authored `<p>`, outside lists, cells and code. */
function ordinaryParagraph($at: ResolvedPos): boolean {
  const block = $at.parent;
  if (block.type !== editorSchema.nodes.paragraph || block.attrs.tag !== 'p' || block.attrs.synthetic) return false;
  for (let depth = $at.depth - 1; depth > 0; depth--)
    if (['list_item', 'table_cell'].includes($at.node(depth).type.name)) return false;
  return !$at.marks().some((mark) => mark.attrs.tag === 'code');
}

/** The paragraph's identity survives the conversion (comments anchor to it); its paragraph styling does not. */
function identityOnly(source: JsxElement | null): JsxElement | null {
  if (!source) return null;
  return { ...source, attributes: source.attributes.filter((a) => ['id', 'data-annotation-anchor', 'dir', 'lang'].includes(a.name)) };
}

/** The structural transaction for a marker already typed (with its space) before the caret, or null. */
function blockShortcut(state: EditorState): Transaction | null {
  const { $from, empty } = state.selection;
  if (!empty || !ordinaryParagraph($from)) return null;
  const typed = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  const marker = BLOCK_SHORTCUT.exec(typed)?.[1];
  if (!marker) return null;
  const start = $from.start();
  const tr = state.tr.delete(start, start + typed.length);
  const paragraph = { ...$from.parent.attrs, source: identityOnly($from.parent.attrs.source as JsxElement | null) };
  if (marker.startsWith('#')) return tr.setNodeMarkup($from.before(), undefined, { ...paragraph, tag: `h${marker.length}` });
  const range = tr.doc.resolve(start).blockRange();
  if (!range) return null;
  const list = marker === '1.' ? editorSchema.nodes.ordered_list : editorSchema.nodes.bullet_list;
  tr.setNodeMarkup($from.before(), undefined, paragraph);
  return tr.wrap(range, [{ type: list }, { type: editorSchema.nodes.list_item }]);
}

/** Enter on an empty item of a top-level list leaves the list (splitListItem only nests out of inner lists). */
const exitEmptyListItem: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.content.size || $from.parent.attrs.synthetic || $from.depth < 2) return false;
  if ($from.node(-1).type !== editorSchema.nodes.list_item) return false;
  return liftListItem(editorSchema.nodes.list_item)(state, dispatch);
};

/** Layout containers remain intact on Enter; only an empty quotation may lift out.
 * Headings share the paragraph node type, so explicitly start body text after their end. */
const splitProse: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (empty && !$from.parent.content.size && $from.depth > 1 && $from.node(-1).attrs.tag === 'blockquote') return false;
  return splitBlockAs((node, atEnd) => atEnd && /^h[1-6]$/.test(node.attrs.tag)
    ? { type: editorSchema.nodes.paragraph } : null)(state, dispatch);
};

/**
 * Several lines of plain text become one paragraph per line, and parsing collapses each line's edge
 * spaces like source whitespace. The text is literal: put back the first line's leading spaces (where it
 * joins the text before the caret) and the last line's trailing spaces (where it joins the text after).
 */
function keepPastedEdgeSpaces(tr: Transaction, from: number, plain: string) {
  const lines = plain.split(/\r\n|\r|\n/);
  const first = lines[0] ?? '', last = lines.at(-1) ?? '';
  const insert = (spaces: string, at: number) => {
    if (spaces && tr.doc.resolve(at).parent.isTextblock) tr.insertText(spaces, at);
  };
  if (last.trim()) {
    const $end = tr.doc.resolve(tr.selection.from);
    const kept = /[ \t]*$/.exec($end.parent.textBetween(0, $end.parentOffset))![0].length;
    insert(/[ \t]*$/.exec(last)![0].slice(kept), tr.selection.from);
  }
  if (first.trim()) insert(/^[ \t]*/.exec(first)![0], tr.mapping.map(from, -1));
}

/** How many AST-path decorations one repath step redraws: a few table rows, well inside an idle slice at slow CPUs. */
const REPATH_STEP = 30;

export function mountFlowView(mount: HTMLElement, props: () => FlowEditorProps, onCompositionSettled: () => void): FlowView {
  /** The AST-path decorations last drawn, and for what: recomputed only when the document, its source or its path moves. */
  let memo: { doc: EditorState['doc']; nodes: JsxNode[]; path: string; list: Decoration[]; set: DecorationSet } | null = null;
  /** A partial set while a path change is redrawn in slices (`repath`). */
  let staged: { doc: EditorState['doc']; set: DecorationSet } | null = null;
  let repathTo: string | null = null;
  const pathDecorations = (doc: EditorState['doc'], nodes: JsxNode[], path: string): Decoration[] => {
    const parts = path.split('.'),
      first = Number(parts.pop()),
      parent = parts.join('.');
    const decorations: Decoration[] = [];
    // Engine blocks omit source whitespace and introduce synthetic text
    // wrappers. Walk the authored siblings alongside them; engine child
    // ordinals are never AST paths. IDs also prevent a pending structural
    // edit from pointing the toolbar at a different source node.
    const visit = (container: typeof doc, source: JsxNode[], pos: number, parentPath: string, base = 0) => {
      let cursor = 0;
      container.forEach((node, offset) => {
        if (node.isText || node.isInline || node.attrs.synthetic) return;
        const original = node.attrs.source as JsxElement | null;
        if (!original) return;
        const id = original.attributes.find((a) => a.name === 'id')?.value;
        const index = source.findIndex((candidate, i) => i >= cursor &&
          candidate.type === 'element' && candidate.tag === original.tag &&
          (!id?.static || candidate.attributes.some((a) => a.name === 'id' && a.value.static && a.value.json === id.json)));
        if (index < 0) return;
        cursor = index + 1;
        const path = [parentPath, String(base + index)].filter(Boolean).join('.');
        const position = pos + offset;
        const placeholder = original.attributes.find(a => a.name === 'data-placeholder')?.value;
        decorations.push(Decoration.node(position, position + node.nodeSize, {
          'data-mx-ast': path,
          ...(node.isTextblock && node.content.size === 0 && placeholder?.static && typeof placeholder.json === 'string'
            ? { 'data-mx-placeholder': placeholder.json } : {}),
        }));
        const authored = source[index];
        if (authored.type === 'element' && !node.isTextblock)
          visit(node, authored.children, position + 1, path);
      });
    };
    visit(doc, nodes, 0, parent, first);
    return decorations;
  };
  const state = { composing: false };
  /** Typing ProseMirror has drawn but the page has not been handed yet: one undo step, one source edit. */
  let held: { group: string; before: ReturnType<typeof captureBookmark>; maps: ReturnType<typeof mergeIdentityMaps> } | null = null;
  let heldTimer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  const syncBusy = () => {
    const next = state.composing || !!held;
    if (next !== busy) { busy = next; props().onBusy?.(next); }
  };
  const emit = (group: string | undefined, before: ReturnType<typeof captureBookmark>, maps: ReturnType<typeof mergeIdentityMaps>) => {
    props().onChange(sourceNodes(view.state.doc), group, {
      before,
      after: captureBookmark(view.state),
      ...(maps.length ? { annotationOperation: { id: runtimeId(), kind: 'map', maps } as const } : {}),
    });
  };
  const flush = () => {
    clearTimeout(heldTimer);
    const pending = held;
    if (!pending) return;
    held = null;
    emit(pending.group, pending.before, pending.maps);
    syncBusy();
  };
  let plainPaste = false;
  let compositionTimer: ReturnType<typeof setTimeout> | undefined;
  const view = new EditorView(mount, {
    state: EditorState.create({
      doc: editorDocument(props().nodes),
      plugins: [
        keymap({
          'Mod-b': (state, dispatch) => {
            dispatch?.(toggleInline(state, 'strong').setMeta('mx-command', true));
            return true;
          },
          'Mod-i': (state, dispatch) => {
            dispatch?.(toggleInline(state, 'em').setMeta('mx-command', true));
            return true;
          },
          ...baseKeymap,
          Enter: chainCommands(
            (state, dispatch) => {
              if (state.selection.$from.parent.attrs.tag !== 'pre') return false;
              dispatch?.(state.tr.insertText('\n'));
              return true;
            },
            splitListItem(editorSchema.nodes.list_item),
            exitEmptyListItem,
            splitProse,
            baseKeymap.Enter,
          ),
          Tab: sinkListItem(editorSchema.nodes.list_item),
          'Shift-Tab': liftListItem(editorSchema.nodes.list_item),
        }),
      ],
    }),
    nodeViews: Object.fromEntries(
      Object.entries(editorSchema.nodes)
        .filter(([, type]) => !!type.spec.toDOM)
        .map(([name, type]) => [
          name,
          (node: import('prosemirror-model').Node, view: EditorView) => {
            const rendered = DOMSerializer.renderSpec(view.dom.ownerDocument, type.spec.toDOM!(node));
            return {
              ...rendered,
              ignoreMutation(mutation: import('prosemirror-view').ViewMutationRecord) {
                // Selection/hover/AST chrome is ephemeral UI, never authored input.
                return mutation.type === 'attributes' && !!mutation.attributeName?.startsWith('data-mx-');
              },
            };
          },
        ]),
    ) as import('prosemirror-view').EditorProps['nodeViews'],
    decorations(current) {
      // Staged: a path change being redrawn in slices (repath) shows its partial set until the document changes.
      if (staged && staged.doc === current.doc) return staged.set;
      staged = null;
      const { nodes } = props();
      // A path `repath` moved to holds until the props carry it (its mounter sets them next) or another one.
      if (repathTo !== null && props().path === repathTo) repathTo = null;
      const path = repathTo ?? props().path;
      // A selection or other doc-preserving transaction redraws nothing: the paths are the same as last time.
      if (!memo || memo.doc !== current.doc || memo.nodes !== nodes || memo.path !== path) {
        const list = pathDecorations(current.doc, nodes, path);
        // A copy: building a set empties the array it is given, and a repath draws from this list in steps.
        memo = { doc: current.doc, nodes, path, list, set: DecorationSet.create(current.doc, [...list]) };
      }
      return memo.set;
    },
    attributes: {
      role: 'textbox',
      'aria-label': 'Document text',
      'aria-multiline': 'true',
      class: 'ProseMirror mx-prose-editor',
    },
    editable: () => props().canEdit?.() !== false,
    dispatchTransaction(transaction) {
      if (!transaction.docChanged && props().canEdit?.() === false) return;
      if (transaction.docChanged && props().canEdit?.() === false) {
        view.updateState(view.state);
        return;
      }
      const cell = (point: typeof view.state.selection.$from) => {
        for (let d = point.depth; d > 0; d--) if (point.node(d).type.name === 'table_cell') return point.before(d);
        return null;
      };
      const selection = view.state.selection;
      if (transaction.docChanged && cell(selection.$from) !== cell(selection.$to)) {
        view.updateState(view.state);
        props().onError?.('Edit one table cell at a time. Select text inside a cell to replace it.');
        return;
      }
      const group = transaction.getMeta('uiEvent') === 'paste' || transaction.getMeta('mx-command') ? undefined : `typing:${props().path}`;
      // A paste or a command is its own step: typing held before it is handed over first, as it stood.
      if (transaction.docChanged && group === undefined) flush();
      const before = captureBookmark(view.state);
      const tr = normalizeIdentities(transaction, true);
      const maps = tr.docChanged ? mergeIdentityMaps(view.state.doc, tr) : [];
      view.updateState(view.state.apply(tr));
      props().onView?.(view);
      if (!tr.docChanged) return;
      if (group === undefined) {
        emit(undefined, before, maps);
        return;
      }
      // A paragraph broken or joined (Enter, Backspace at a block's edge) is handed over at once: the page's tree
      // moves, and the draft that follows should not wait for typing to pause.
      const structural = tr.steps.some((step) => {
        const json = step.toJSON() as { stepType?: string; from?: number; to?: number; slice?: { openStart?: number; openEnd?: number; content?: Array<{ type: string }> } };
        if (json.stepType !== 'replace') return true;
        if (json.slice && (json.slice.openStart || json.slice.openEnd || json.slice.content?.some((node) => node.type !== 'text'))) return true;
        return json.from !== json.to && tr.before.resolve(json.from!).parent !== tr.before.resolve(json.to!).parent;
      });
      // Typing is held: drawn already, handed over once it pauses, as ONE edit.
      if (held) held.maps.push(...maps);
      else held = { group, before, maps };
      clearTimeout(heldTimer);
      if (structural) { flush(); return; }
      heldTimer = setTimeout(flush, FLOW_IDLE_MS);
      syncBusy();
    },
    handleDOMEvents: {
      dragstart(_view, event) {
        // Text drags must not become cross-engine HTML moves. Source blocks
        // move only through the dedicated grip and its checked transaction.
        event.preventDefault();
        return true;
      },
      compositionstart() {
        state.composing = true;
        syncBusy();
        return false;
      },
      compositionend() {
        compositionTimer = setTimeout(() => {
          state.composing = false;
          syncBusy();
          onCompositionSettled();
        }, 30);
        return false;
      },
      blur() {
        flush();
        return false;
      },
    },
    handleTextInput(view, from, to, text, typing) {
      if (from !== to || !/^[ \u00a0]$/.test(text) || state.composing || view.composing || props().canEdit?.() === false) return false;
      const $from = view.state.doc.resolve(from);
      if (!ordinaryParagraph($from) || !BLOCK_SHORTCUT.test($from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc') + text)) return false;
      view.dispatch(typing());
      const convert = blockShortcut(view.state);
      if (convert) view.dispatch(convert.setMeta('mx-command', true).scrollIntoView());
      return true;
    },
    handleKeyDown(view, event) {
      if (moveToLineBoundary(view, event)) return true;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') plainPaste = true;
      else plainPaste = false;
      return false;
    },
    handlePaste(_view, event) {
      const data = event.clipboardData;
      if (!data || data.files.length) return false;
      if (plainPaste || view.state.selection.$from.parent.attrs.tag === 'pre') {
        plainPaste = false;
        try {
          clipboardAst('text', data.getData('text/plain'));
          view.dispatch(
            view.state.tr.insertText(data.getData('text/plain')).setMeta('uiEvent', 'paste').scrollIntoView(),
          );
        } catch (error) {
          props().onError?.(error instanceof Error ? error.message : 'Paste could not be inserted.');
        }
        return true;
      }
      const markup = data.getData('text/html');
      const plain = data.getData('text/plain');
      if (!markup && plain && !/[\r\n]/.test(plain)) {
        // One line of plain text is literal text, exactly as typing it: parsed as a paragraph, its edge spaces
        // would collapse like source whitespace (" world" after "hello" became "helloworld").
        try {
          clipboardAst('text', plain);
          view.dispatch(view.state.tr.insertText(plain).setMeta('uiEvent', 'paste').scrollIntoView());
        } catch (error) {
          props().onError?.(error instanceof Error ? error.message : 'Paste could not be inserted.');
        }
        return true;
      }
      const kind: ClipboardKind = markup ? 'html' : 'text';
      const value = markup || data.getData('text/plain');
      try {
        const from = view.state.selection.from;
        const tr = view.state.tr.replaceSelection(pasteFragment(clipboardAst(kind, value)));
        if (kind === 'text') keepPastedEdgeSpaces(tr, from, value);
        view.dispatch(tr.setMeta('uiEvent', 'paste').scrollIntoView());
      } catch (error) {
        props().onError?.(error instanceof Error ? error.message : 'Paste could not be inserted.');
      }
      return true;
    },
  });
  const mountedCallback = props().onView;
  mountedCallback?.(view);
  flushers.set(view, flush);
  const flowView: FlowView = {
    view,
    flush,
    composing: () => state.composing,
    repathing: (path) => repathTo === path,
    repath(to) {
      repathTo = to;
      // The decorations on screen stay until the step runs (a selection change meanwhile redraws nothing).
      const from = memo;
      if (from && !staged) staged = { doc: from.doc, set: from.set };
      // A table's cells are redrawn REPATH_STEP at a time: each step draws the new path up to its share and keeps the
      // last drawn one after it, so no step redraws the whole table (one table was a 50 ms task at slow CPUs).
      const count = Math.max(1, Math.ceil((from?.list.length ?? 0) / REPATH_STEP));
      let list: Decoration[] | null = null;
      return Array.from({ length: count }, (_, index) => () => {
        if (view.isDestroyed) return;
        // A composition, or a document changed meanwhile, takes the new path whole at its next update.
        const doc = view.state.doc, { nodes } = props();
        if (state.composing || !staged || staged.doc !== doc || !from || from.doc !== doc || from.nodes !== nodes) { staged = null; return; }
        list ??= pathDecorations(doc, nodes, to);
        if (list.length === from.list.length) {
          // This step's share swapped in the set drawn so far (rebuilding the whole set every step walked every cell).
          const share = [index * REPATH_STEP, (index + 1) * REPATH_STEP] as const;
          const set = staged.set.remove(from.list.slice(...share)).add(doc, list.slice(...share));
          if (index < count - 1) staged = { doc, set };
          else { staged = null; memo = { doc, nodes, path: to, list, set }; }
        } else {
          staged = null;
          memo = { doc, nodes, path: to, list, set: DecorationSet.create(doc, [...list]) };
        }
        // Drawn whole (the last step, or the tree's shape moved): the steps left find nothing staged and do nothing.
        view.updateState(view.state);
      });
    },
    sync(nodes) {
      if (state.composing) return;
      // The page's source never replaces typing it has not been handed: hand it over first.
      flush();
      // Compare engine to engine: parsing collapses source whitespace, so the incoming source is
      // compared in its parsed form — an echo of our own edit, or a reindent, rebuilds nothing.
      const doc = editorDocument(nodes);
      if (serializeJsx(sourceNodes(view.state.doc)) === serializeJsx(sourceNodes(doc))) {
        // A normalized source echo can change AST paths without changing prose.
        view.updateState(view.state);
        return;
      }
      const position = Math.min(view.state.selection.from, doc.content.size);
      view.updateState(EditorState.create({ doc, plugins: view.state.plugins, selection: TextSelection.near(doc.resolve(position)) }));
      props().onView?.(view);
    },
    destroy() {
      clearTimeout(compositionTimer);
      flush();
      flushers.delete(view);
      repathers.delete(view);
      if (busy) props().onBusy?.(false);
      // Pair cleanup with the registration callback, even if the adapter replaced props.
      mountedCallback?.(null);
      view.destroy();
    },
  };
  repathers.set(view, (path) => flowView.repath(path));
  return flowView;
}
