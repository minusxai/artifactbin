import type { AnnotationRange } from '../document';
import { htmlTextFingerprint, type HtmlNodeAnchor } from '@artifactbin/contracts';
import { resolveHtmlRange } from './range';
interface HtmlAnnotationPin { id: string; nodeId?: string | null; path: string; anchor?: HtmlNodeAnchor; layoutOnly?: boolean; range?: AnnotationRange | null }
export interface HtmlAnnotationPaint { pins: readonly HtmlAnnotationPin[]; mode: 'off' | 'on'; openId: string | null; hoverId: string | null }
export interface HtmlAnnotationPosition { id: string; status: 'exact' | 'missing' | 'ambiguous'; rect: { x: number; y: number; width: number; height: number } }
const box = (rect: { x: number; y: number; width: number; height: number }) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
/** Resolve identities only in their declared scope; missing/duplicate scopes never fall back globally. */
function htmlAnchorElements(doc:Document,nodeId:string,ancestorId?:string):Element[]{
 const nodes=[...doc.querySelectorAll('[data-af-id]')];
 const ancestors=ancestorId ? nodes.filter(node=>node.getAttribute('data-af-id')===ancestorId) : null;
 const scope=ancestors ? ancestors.length===1 ? [...ancestors[0]!.querySelectorAll('[data-af-id]')] : [] : nodes;
 return scope.filter(node=>node.getAttribute('data-af-id')===nodeId);
}
/** Reveal only a unique target within its persisted scope. Stale anchors stay missing. */
export function revealHtmlAnnotation(doc:Document,pin:HtmlAnnotationPaint['pins'][number]):void {
 const matches=htmlAnchorElements(doc,pin.anchor?.nodeId??pin.nodeId??pin.path,pin.anchor?.ancestorId);
 if(matches.length===1)matches[0]?.scrollIntoView?.({block:'nearest'});
}
/** Paint in an inert overlay: authored DOM/text and the viewer's native selection stay intact. */
export function createHtmlAnnotationPainter(doc: Document) {
  const overlay = doc.createElement('div');
  overlay.setAttribute('data-af', 'annotation-overlay');
  Object.assign(overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483646' });
  doc.documentElement.append(overlay);
  return {
    ownsOverlay:(node:Node)=>node===overlay||overlay.contains(node),
    paint(input: HtmlAnnotationPaint): HtmlAnnotationPosition[] {
      overlay.replaceChildren();
      return input.pins.map((pin) => {
        const matches = htmlAnchorElements(doc,pin.anchor?.nodeId ?? pin.nodeId ?? pin.path,pin.anchor?.ancestorId);
        const node = matches.length === 1 ? matches[0]! : null;
        if (!node) return { id: pin.id, status: matches.length ? 'ambiguous' : 'missing', rect: { x: 0, y: 0, width: 0, height: 0 } };
        const ranges: Range[] = [];
        if(pin.anchor?.segments){
          if(!pin.anchor.segments.length)return {id:pin.id,status:'missing',rect:box(node.getBoundingClientRect())};
          for(const part of pin.anchor.segments){
            const targets=htmlAnchorElements(doc,part.nodeId);
            if(targets.length!==1)return {id:pin.id,status:targets.length?'ambiguous':'missing',rect:box(node.getBoundingClientRect())};
            const target=targets[0]!,text=target.textContent??'',range=part.range;
            if(text.length!==range.length || htmlTextFingerprint(text)!==range.fingerprint || text.slice(range.start,range.end).replace(/\s+/g,' ').trim()!==part.quote.replace(/\s+/g,' ').trim())return {id:pin.id,status:'missing',rect:box(node.getBoundingClientRect())};
            const partResolved=resolveHtmlRange(target,{...pin.anchor,nodeId:part.nodeId,quote:part.quote,range,segments:undefined});
            if(!partResolved.range || partResolved.status!=='exact')return {id:pin.id,status:partResolved.status,rect:box(node.getBoundingClientRect())};
            ranges.push(partResolved.range);
          }
        }
        const resolved = !pin.anchor?.segments && pin.anchor?.quote ? resolveHtmlRange(node, pin.anchor) : null;
        if (resolved && resolved.status !== 'exact') return { id: pin.id, status: resolved.status, rect: box(node.getBoundingClientRect()) };
        const sourceRange = pin.range?.kind === 'target' ? pin.range.range : pin.range;
        const nodeRect = node.getBoundingClientRect();
        const area = sourceRange?.kind === 'area' ? sourceRange.box : null;
        const areaRect = area ? { x: nodeRect.x + area.x * nodeRect.width, y: nodeRect.y + area.y * nodeRect.height, width: area.w * nodeRect.width, height: area.h * nodeRect.height } : null;
        const rects = ranges.length ? ranges.flatMap(range=>typeof range.getClientRects==='function'?[...range.getClientRects()]:[]) : areaRect ? [areaRect] : resolved?.range && typeof resolved.range.getClientRects === 'function' ? [...resolved.range.getClientRects()] : [node.getBoundingClientRect()];
        const active = input.openId === pin.id || input.hoverId === pin.id;
        if (!pin.layoutOnly && (input.mode === 'on' || active)) for (const rect of rects) {
          const mark = doc.createElement('div');
          Object.assign(mark.style, { position: 'fixed', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, background: active ? 'rgba(59,130,246,.20)' : 'rgba(250,204,21,.20)', outline: active ? '1px solid rgba(59,130,246,.6)' : 'none', pointerEvents: 'none' });
          overlay.append(mark);
        }
        const rect = ranges.length ? (()=>{const boxes=ranges.map(range=>typeof range.getBoundingClientRect==='function'?range.getBoundingClientRect():node.getBoundingClientRect());const x=Math.min(...boxes.map(r=>r.x)),y=Math.min(...boxes.map(r=>r.y));return {x,y,width:Math.max(...boxes.map(r=>r.right))-x,height:Math.max(...boxes.map(r=>r.bottom))-y};})() : areaRect ?? (resolved?.range && typeof resolved.range.getBoundingClientRect === 'function' ? resolved.range.getBoundingClientRect() : node.getBoundingClientRect());
        return { id: pin.id, status: 'exact', rect: box(rect) };
      });
    },
    dispose: () => overlay.remove(),
  };
}
