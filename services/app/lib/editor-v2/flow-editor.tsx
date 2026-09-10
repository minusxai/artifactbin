'use client';

/** A continuous prose region. React owns its boundary; ProseMirror owns its descendants. */
import { useLayoutEffect, useRef, useState } from 'react';
import { DOMSerializer } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list';
import { baseKeymap, chainCommands } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { serializeJsx, type JsxNode } from '@/lib/jsx';
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
export function FlowEditor({ nodes, path, onChange, onView, onError, onBusy, canEdit }: FlowEditorProps) {
  const [compositionEpoch, setCompositionEpoch] = useState(0);
  const composing = useRef(false);
  const mount = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef({ nodes, path, onChange, onView, onError, onBusy, canEdit });
  latest.current = { nodes, path, onChange, onView, onError, onBusy, canEdit };
  const incoming = serializeJsx(nodes);
  useLayoutEffect(() => {
    let plainPaste = false;
    let compositionTimer: ReturnType<typeof setTimeout> | undefined;
    const view = new EditorView(mount.current!, {
      state: EditorState.create({
        doc: editorDocument(latest.current.nodes),
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
        const parts = latest.current.path.split('.'),
          first = Number(parts.pop()),
          parent = parts.join('.');
        const decorations: Decoration[] = [];
        const visit = (node: typeof state.doc, pos: number, path: string) => {
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-mx-ast': path }));
          let index = 0;
          node.forEach((child, offset) => {
            if (child.attrs.synthetic) {
              index += sourceNodes(child).length;
              return;
            }
            if (!child.isText) visit(child, pos + 1 + offset, `${path}.${index}`);
            index++;
          });
        };
        let index = 0;
        state.doc.forEach((node, pos) => visit(node, pos, [parent, String(first + index++)].filter(Boolean).join('.')));
        return DecorationSet.create(state.doc, decorations);
      },
      attributes: {
        role: 'textbox',
        'aria-label': 'Document text',
        'aria-multiline': 'true',
        class: 'ProseMirror mx-prose-editor',
      },
      editable: () => latest.current.canEdit?.() !== false,
      dispatchTransaction(transaction) {
        if (!transaction.docChanged && latest.current.canEdit?.() === false) return;
        if (transaction.docChanged && latest.current.canEdit?.() === false) {
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
          latest.current.onError?.('Edit one table cell at a time. Select text inside a cell to replace it.');
          return;
        }
        const before = captureBookmark(view.state);
        const tr = normalizeIdentities(transaction, true);
        const maps = tr.docChanged ? mergeIdentityMaps(view.state.doc, tr) : [];
        view.updateState(view.state.apply(tr));
        latest.current.onView?.(view);
        if (tr.docChanged)
          latest.current.onChange(
            sourceNodes(view.state.doc),
            tr.getMeta('uiEvent') === 'paste' || tr.getMeta('mx-command') ? undefined : `typing:${latest.current.path}`,
            {
              before,
              after: captureBookmark(view.state),
              ...(maps.length
                ? {
                    annotationOperation: {
                      id: crypto.randomUUID(),
                      kind: 'map',
                      maps,
                    } as const,
                  }
                : {}),
            },
          );
      },
      handleDOMEvents: {
        dragstart(_view, event) {
          // Text drags must not become cross-engine HTML moves. Source blocks
          // move only through the dedicated grip and its checked transaction.
          event.preventDefault();
          return true;
        },
        compositionstart() {
          composing.current = true;
          latest.current.onBusy?.(true);
          return false;
        },
        compositionend() {
          compositionTimer = setTimeout(() => {
            composing.current = false;
            latest.current.onBusy?.(false);
            setCompositionEpoch((n) => n + 1);
          }, 30);
          return false;
        },
      },
      handleKeyDown(_view, event) {
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
            latest.current.onError?.(error instanceof Error ? error.message : 'Paste could not be inserted.');
          }
          return true;
        }
        const markup = data.getData('text/html');
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
          latest.current.onError?.(error instanceof Error ? error.message : 'Paste could not be inserted.');
        }
        return true;
      },
    });
    viewRef.current = view;
    const mountedCallback = latest.current.onView;
    mountedCallback?.(view);
    return () => {
      clearTimeout(compositionTimer);
      if (composing.current) latest.current.onBusy?.(false);
      // Pair cleanup with the registration callback, even if React replaced props.
      mountedCallback?.(null);
      view.destroy();
      viewRef.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || composing.current || serializeJsx(sourceNodes(view.state.doc)) === incoming) return;
    const doc = editorDocument(nodes);
    const position = Math.min(view.state.selection.from, doc.content.size);
    view.updateState(
      EditorState.create({
        doc,
        plugins: view.state.plugins,
        selection: TextSelection.near(doc.resolve(position)),
      }),
    );
    latest.current.onView?.(view);
  }, [incoming, nodes, compositionEpoch]);
  return <div ref={mount} className="mx-prose-region" style={{ display: 'contents' }} />;
}
