'use client';

/**
 * THE REACT RENDER SEAM, for `edit/session`'s core.
 *
 * `edit/session.tsx` is dynamically imported on the compiled-DOM path too
 * (components/IslandStory), where editing attaches directly to server-rendered
 * markup (@/solid/editor/dom-mounter) and no React tree exists to decorate.
 * This module is the OTHER path: `StoryRuntimeApp` still renders the document
 * as a live React tree (lib/story-runtime/EditorStoryRuntime), and needs two
 * seams filled — wrapping a rendered element (`decorate`) and grouping prose
 * siblings into ProseMirror regions (`decorateChildren`). Only
 * `EditorStoryRuntime` imports this file, via `createFrameEditSession`'s
 * `decorateFactory` option; the core session never imports React.
 *
 * Everything here reads and writes the core session's state through the
 * `EditSessionDecorateInternals` it was given — this module owns no state of
 * its own beyond the entry-scroll bookkeeping local to `decorateChildren`.
 */
import { cloneElement, createElement, type ReactElement, type ReactNode } from 'react';
import { serializeJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import type { EditorSelectionChange } from '@/lib/editor-v2/bookmark';
import { FlowEditor } from '@/lib/editor-v2/flow-editor';
import { isProseTree } from '@/lib/editor-v2/model';
import { isEditableTextHost } from '@/lib/story-ui/host-classify';
import type { EditorView } from 'prosemirror-view';
import { STORY_FLOW_EDIT_MESSAGE, STORY_LAYOUT_EDIT_MESSAGE } from '../contract';
import { EditableHost } from './editable-host';
import { GridEdit } from './grid-edit';
import type { EditSessionDecorateAPI, EditSessionDecorateInternals } from './session';

/** Inline children belong to their parent textblock, never nested editors. */
const isBlock = (n: JsxNode): boolean =>
  n.type === 'element' &&
  ![
    'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'span', 'strong', 'b', 'em', 'i', 'a', 'code', 'br',
    'small', 'sup', 'sub', 's', 'del', 'u',
  ].includes(n.tag) &&
  isProseTree(n);

export function createEditSessionDecorator(internals: EditSessionDecorateInternals): EditSessionDecorateAPI {
  const { win, hostSession, views, getBodyEpoch, blockSelectionPaths, post, reportTyping, restorePending,
    reportSelection, describeWithQuote, setLastView, restoreScroll } = internals;
  const doc = win.document;
  // Used only by decorateChildren, to put the reader back where they entered
  // once the first prose region mounts — the compiled-DOM path restores its
  // own scroll around `mountCompiledDom` and never touches this.
  let entering = true;
  const entryScroll = { x: win.scrollX, y: win.scrollY };

  return {
    decorateChildren(children: ReactNode[], source: JsxNode[], parentPath: string): ReactNode {
      const result: ReactNode[] = [];
      for (let index = 0; index < source.length;) {
        const start = index;
        if (!isBlock(source[index])) {
          result.push(children[index++]);
          continue;
        }
        index++;
        while (
          index < source.length &&
          (isBlock(source[index]) ||
            (source[index].type === 'text' && !(source[index] as { value: string }).value.trim()))
        )
          index++;
        let previous = source.slice(start, index);
        const path = [parentPath, String(start)].filter(Boolean).join('.');
        const first = previous[0];
        const id = first.type === 'element' ? first.attributes.find((a) => a.name === 'id')?.value : null;
        let regionView: EditorView | null = null;
        result.push(
          createElement(FlowEditor, {
            key: id?.static ? String(id.json) : path,
            nodes: previous,
            path,
            onError(message: string) {
              post({ type: 'mx:edit-error', message });
            },
            onBusy: reportTyping,
            canEdit: () => blockSelectionPaths().length === 0,
            onView(view: EditorView | null) {
              if (regionView) views.delete(regionView);
              regionView = view;
              if (view) {
                views.add(view);
                win.requestAnimationFrame(restorePending);
                if (view.hasFocus()) {
                  setLastView(view);
                  win.queueMicrotask(() => {
                    const anchor = doc.getSelection()?.anchorNode;
                    const el = (anchor?.nodeType === 1 ? (anchor as Element) : anchor?.parentElement)?.closest(
                      '[data-mx-ast]',
                    );
                    if (el && view.dom.contains(el)) reportSelection(describeWithQuote(el));
                  });
                }
              }
              if (view && entering)
                win.requestAnimationFrame(() => {
                  restoreScroll(entryScroll);
                  entering = false;
                });
            },
            onChange(next: JsxNode[], group?: string, selection?: EditorSelectionChange) {
              post({
                type: STORY_FLOW_EDIT_MESSAGE,
                path,
                expected: serializeJsx(previous),
                replacement: serializeJsx(next),
                group,
                selection,
              });
              previous = next;
            },
          }),
        );
      }
      return result;
    },
    decorate(element: ReactElement, node: JsxElement, path: string): ReactNode {
      // A grid becomes draggable: only the document knows how wide its columns
      // are, so the drag happens here and the rects travel (edit/grid-edit).
      if (node.isComponent && node.tag === 'Grid') {
        // Flow uses the reader tree unchanged; overlay handles own its layout gestures.
        if (node.attributes.some((a) => a.name === 'mode' && a.value?.static && a.value.json === 'flow'))
          return element;
        return createElement(GridEdit, {
          key: (element as ReactElement).key ?? path,
          props: (element as ReactElement<Record<string, unknown>>).props,
          onLayout: (rects) => post({ type: STORY_LAYOUT_EDIT_MESSAGE, rects }),
        });
      }
      /*
       * A <Video> card is an <a> to the video's own page. While editing, that
       * link would swallow the click meant to SELECT the embed and take the
       * author out of their own document; the kit already has the seam for it.
       */
      if (node.isComponent && node.tag === 'Video') {
        return cloneElement(element as ReactElement<Record<string, unknown>>, { interactive: false });
      }
      if (node.isComponent || !isEditableTextHost(node)) return element;
      return createElement(EditableHost, {
        key: (element as ReactElement).key ?? path,
        path,
        session: hostSession,
        bodyEpoch: getBodyEpoch(),
        children: element as ReactElement<Record<string, unknown>>,
      });
    },
  };
}
