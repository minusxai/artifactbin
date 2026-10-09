import type { AnnotationOperation } from './annotation-map';
/** Text endpoints use persistent block IDs; offsets are local to that block. */
import { TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import type { JsxElement } from '@/lib/jsx';
interface TextEndpoint {
  id: string;
  offset: number;
}
export interface EditorSelectionChange {
  before?: EditorBookmark;
  after?: EditorBookmark;
  annotationOperation?: AnnotationOperation;
}
export interface EditorBookmark {
  anchor: TextEndpoint;
  head: TextEndpoint;
}
function sourceId(source: JsxElement | null): string | null {
  const id = source?.attributes.find((a) => a.name === 'id')?.value;
  return id?.static && typeof id.json === 'string' ? id.json : null;
}
export function captureBookmark(state: EditorState): EditorBookmark | undefined {
  const endpoint = (position: number): TextEndpoint | undefined => {
    const resolved = state.doc.resolve(position),
      id = sourceId(resolved.parent.attrs.source);
    return id ? { id, offset: resolved.parentOffset } : undefined;
  };
  const anchor = endpoint(state.selection.anchor),
    head = endpoint(state.selection.head);
  return anchor && head ? { anchor, head } : undefined;
}
/** Resolve without dispatching or focusing: remote updates must not steal keyboard focus. */
export function resolveBookmark(doc: Node, bookmark: EditorBookmark): TextSelection | undefined {
  const locate = (point: TextEndpoint) => {
    let position: number | undefined;
    doc.descendants((node, pos) => {
      if (node.isTextblock && sourceId(node.attrs.source) === point.id)
        position = pos + 1 + Math.min(node.content.size, Math.max(0, point.offset));
    });
    return position;
  };
  const anchor = locate(bookmark.anchor),
    head = locate(bookmark.head);
  return anchor === undefined || head === undefined ? undefined : TextSelection.create(doc, anchor, head);
}
export function restoreBookmark(view: EditorView, bookmark: EditorBookmark): boolean {
  if (view.isDestroyed) return false;
  const selection = resolveBookmark(view.state.doc, bookmark);
  if (!selection) return false;
  view.dispatch(view.state.tr.setSelection(selection));
  view.focus();
  return true;
}
