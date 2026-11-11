/**
 * COLLABORATORS' CARETS IN A LIVE REGION, inside the page frame (part of the lazily loaded `@afbin/regions`).
 *
 * A caret travels as Yjs relative positions (contracts RegionCaret: base64, at most 256 bytes each), so it stays on the
 * character it was next to whatever anyone typed since. Capture reads this editor's selection as relative positions,
 * with the marks and block at the caret (the toolbar's state); painting turns each collaborator's back into document
 * positions (absolutePosition) and draws them in an inert overlay OUTSIDE the editable root, so the editor's DOM
 * observer never sees a caret. Nothing here holds or sends credentials: bytes and geometry only.
 */
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { RegionCaret } from '@artifactbin/contracts';

/** A collaborator's caret as the parent paints it (contracts region-paint). */
export type RegionCaretPaint = RegionCaret & { id: string; colorId?: string; label: string };

/** A stable, readable colour per collaborator. */
function colourOf(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 70% 42%)`;
}

export interface RegionCaretPainter {
  /** The collaborators' carets (every region's; only this region's are drawn). */
  paint(carets: readonly RegionCaretPaint[]): void;
  /** Draws the last carets again (the text or the layout moved). */
  refresh(): void;
  /** The overlay, to keep page observers off it. */
  owns(node: Node): boolean;
  dispose(): void;
}

/** Draws other people's carets for one region's editor, in document coordinates (they scroll with the page). */
export function createRegionCaretPainter(view: EditorView, regionId: string, decode: (state: EditorState, position: string) => number | null): RegionCaretPainter {
  const doc = view.dom.ownerDocument;
  const win = doc.defaultView!;
  const layer = doc.createElement('div');
  layer.setAttribute('data-af', 'region-carets');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', pointerEvents: 'none', zIndex: '2147483644' });
  doc.documentElement.append(layer);
  const marks = new Map<string, { caret: HTMLElement; flag: HTMLElement }>();
  let carets: readonly RegionCaretPaint[] = [];

  const draw = () => {
    const shown = new Set<string>();
    for (const caret of carets) {
      if (caret.regionId !== regionId || shown.has(caret.id)) continue;
      const pos = decode(view.state, caret.head);
      if (pos === null) continue;
      let box: { left: number; top: number; bottom: number };
      try { box = view.coordsAtPos(Math.min(pos, view.state.doc.content.size)); } catch { continue; }
      shown.add(caret.id);
      let mark = marks.get(caret.id);
      if (!mark) {
        const element = doc.createElement('div');
        element.setAttribute('data-af-region-caret', caret.id);
        const flag = doc.createElement('div');
        element.append(flag);
        layer.append(element);
        mark = { caret: element, flag };
        marks.set(caret.id, mark);
      }
      const colour = colourOf(caret.colorId ?? caret.id);
      Object.assign(mark.caret.style, { position: 'absolute', left: `${box.left + win.scrollX}px`, top: `${box.top + win.scrollY}px`, height: `${Math.max(box.bottom - box.top, 1)}px`, width: '0', borderLeft: `2px solid ${colour}`, marginLeft: '-1px' });
      Object.assign(mark.flag.style, { position: 'absolute', left: '-2px', bottom: '100%', whiteSpace: 'nowrap', font: '600 11px/1.4 system-ui, sans-serif', color: '#fff', background: colour, borderRadius: '3px 3px 3px 0', padding: '0 4px' });
      if (mark.flag.textContent !== caret.label) mark.flag.textContent = caret.label;
    }
    for (const [id, mark] of marks) if (!shown.has(id)) { mark.caret.remove(); marks.delete(id); }
  };
  win.addEventListener('resize', draw);
  return {
    paint(next) { carets = next; draw(); },
    refresh: draw,
    owns: (node) => node === layer || layer.contains(node),
    dispose() { win.removeEventListener('resize', draw); layer.remove(); marks.clear(); },
  };
}
