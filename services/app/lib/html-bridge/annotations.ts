import type { AnnotationRange } from '../document';
import type { HtmlNodeAnchor } from '@artifactbin/contracts';
import { resolveHtmlRange } from './range';
interface HtmlAnnotationPin { id: string; nodeId?: string | null; path: string; anchor?: HtmlNodeAnchor; range?: AnnotationRange | null }
export interface HtmlAnnotationPaint { pins: readonly HtmlAnnotationPin[]; mode: 'off' | 'on'; openId: string | null; hoverId: string | null }
export interface HtmlAnnotationPosition { id: string; status: 'exact' | 'missing' | 'ambiguous'; rect: { x: number; y: number; width: number; height: number } }
const box = (rect: { x: number; y: number; width: number; height: number }) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
/** Paint in an inert overlay: authored DOM/text and the viewer's native selection stay intact. */
export function createHtmlAnnotationPainter(doc: Document) {
  const overlay = doc.createElement('div');
  overlay.setAttribute('data-af', 'annotation-overlay');
  Object.assign(overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483646' });
  doc.documentElement.append(overlay);
  return {
    paint(input: HtmlAnnotationPaint): HtmlAnnotationPosition[] {
      overlay.replaceChildren();
      const nodes = [...doc.querySelectorAll('[data-af-id]')];
      return input.pins.map((pin) => {
        const matches = nodes.filter((node) => node.getAttribute('data-af-id') === (pin.anchor?.nodeId ?? pin.nodeId ?? pin.path));
        const node = matches.length === 1 ? matches[0]! : null;
        if (!node) return { id: pin.id, status: matches.length ? 'ambiguous' : 'missing', rect: { x: 0, y: 0, width: 0, height: 0 } };
        const resolved = pin.anchor?.quote ? resolveHtmlRange(node, pin.anchor) : null;
        if (resolved && resolved.status !== 'exact') return { id: pin.id, status: resolved.status, rect: box(node.getBoundingClientRect()) };
        const sourceRange = pin.range?.kind === 'target' ? pin.range.range : pin.range;
        const nodeRect = node.getBoundingClientRect();
        const area = sourceRange?.kind === 'area' ? sourceRange.box : null;
        const areaRect = area ? { x: nodeRect.x + area.x * nodeRect.width, y: nodeRect.y + area.y * nodeRect.height, width: area.w * nodeRect.width, height: area.h * nodeRect.height } : null;
        const rects = areaRect ? [areaRect] : resolved?.range && typeof resolved.range.getClientRects === 'function' ? [...resolved.range.getClientRects()] : [node.getBoundingClientRect()];
        const active = input.openId === pin.id || input.hoverId === pin.id;
        if (input.mode === 'on' || active) for (const rect of rects) {
          const mark = doc.createElement('div');
          Object.assign(mark.style, { position: 'fixed', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, background: active ? 'rgba(59,130,246,.20)' : 'rgba(250,204,21,.20)', outline: active ? '1px solid rgba(59,130,246,.6)' : 'none', pointerEvents: 'none' });
          overlay.append(mark);
        }
        const rect = areaRect ?? (resolved?.range && typeof resolved.range.getBoundingClientRect === 'function' ? resolved.range.getBoundingClientRect() : node.getBoundingClientRect());
        return { id: pin.id, status: 'exact', rect: box(rect) };
      });
    },
    dispose: () => overlay.remove(),
  };
}
