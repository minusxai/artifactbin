/**
 * A continuous prose region's PROSEMIRROR view, framework-free: the schema-bound editor state,
 * key bindings, node views, AST-path decorations, the guarded transaction pipeline, paste and
 * composition handling. components adapt it — lib/editor-v2/flow-editor (React) owns its boundary
 * with two layout effects; a Solid adapter (P3 probe) with onMount + one effect.
 */
import { DOMSerializer } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list';
import { baseKeymap, chainCommands } from 'prosemirror-commands';
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

export function mountFlowView(mount: HTMLElement, props: () => FlowEditorProps, onCompositionSettled: () => void): FlowView {
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
      ...(maps.length ? { annotationOperation: { id: crypto.randomUUID(), kind: 'map', maps } as const } : {}),
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
    decorations(state) {
      const parts = props().path.split('.'),
        first = Number(parts.pop()),
        parent = parts.join('.');
      const decorations: Decoration[] = [];
      // Engine blocks omit source whitespace and introduce synthetic text
      // wrappers. Walk the authored siblings alongside them; engine child
      // ordinals are never AST paths. IDs also prevent a pending structural
      // edit from pointing the toolbar at a different source node.
      const visit = (container: typeof state.doc, source: JsxNode[], pos: number, parentPath: string, base = 0) => {
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
          decorations.push(Decoration.node(position, position + node.nodeSize, { 'data-mx-ast': path }));
          const authored = source[index];
          if (authored.type === 'element' && !node.isTextblock)
            visit(node, authored.children, position + 1, path);
        });
      };
      visit(state.doc, props().nodes, 0, parent, first);
      return DecorationSet.create(state.doc, decorations);
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
      // Typing is held: drawn already, handed over once it pauses, as ONE edit.
      if (held) held.maps.push(...maps);
      else held = { group, before, maps };
      clearTimeout(heldTimer);
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
        view.dispatch(
          view.state.tr
            .replaceSelection(pasteFragment(clipboardAst(kind, value)))
            .setMeta('uiEvent', 'paste')
            .scrollIntoView(),
        );
      } catch (error) {
        props().onError?.(error instanceof Error ? error.message : 'Paste could not be inserted.');
      }
      return true;
    },
  });
  const mountedCallback = props().onView;
  mountedCallback?.(view);
  flushers.set(view, flush);
  return {
    view,
    flush,
    composing: () => state.composing,
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
      if (busy) props().onBusy?.(false);
      // Pair cleanup with the registration callback, even if the adapter replaced props.
      mountedCallback?.(null);
      view.destroy();
    },
  };
}
