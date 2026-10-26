import {COMMENT_PRESENTATION} from '../frame-edit/comment-presentation';
import type { AnnotationRange } from '../document';
import { htmlTextFingerprint, type HtmlNodeAnchor } from '@artifactbin/contracts';
import { resolveHtmlRange } from './range';
interface HtmlAnnotationPin { id: string; nodeId?: string | null; path: string; anchor?: HtmlNodeAnchor; layoutOnly?: boolean; range?: AnnotationRange | null }
/** Block threads sharing one resolved node share one visual outline; positions remain per thread. */
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
/** Document coordinates match imported source paint; reported positions always stay viewport-relative. */
export interface HtmlAnnotationPainterOptions { coordinateSpace?: 'viewport' | 'document' }
/** Paint in an inert overlay: authored DOM/text and the viewer's native selection stay intact. */
export function createHtmlAnnotationPainter(doc: Document, options: HtmlAnnotationPainterOptions = {}) {
  const documentSpace = options.coordinateSpace === 'document';
  const positioned = (rect: {x:number;y:number}) => ({position:documentSpace?'absolute':'fixed',left:`${rect.x+(documentSpace?(doc.defaultView?.scrollX??0):0)}px`,top:`${rect.y+(documentSpace?(doc.defaultView?.scrollY??0):0)}px`});
  const overlay = doc.createElement('div');
  overlay.setAttribute('data-af', 'annotation-overlay');
  Object.assign(overlay.style, { position: documentSpace?'absolute':'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483646' });
  doc.documentElement.append(overlay);
  type HighlightRegistry={set(name:string,value:unknown):unknown;delete(name:string):unknown};
  const view=doc.defaultView as unknown as {CSS?:{highlights?:HighlightRegistry};Highlight?:new(...ranges:Range[])=>unknown}|null;
  const registered=new Set<string>();
  const clearHighlights=()=>{for(const name of registered)view?.CSS?.highlights?.delete(name);registered.clear();};
  return {
    ownsOverlay:(node:Node)=>node===overlay||overlay.contains(node),
    paint(input: HtmlAnnotationPaint): HtmlAnnotationPosition[] {
      clearHighlights();
      overlay.replaceChildren();
      const blockMarks = new Map<Element, {mark: HTMLElement; active: boolean}>();
      return input.pins.map((pin) => {
        const matches = htmlAnchorElements(doc,pin.anchor?.nodeId ?? pin.nodeId ?? pin.path,pin.anchor?.ancestorId);
        const node = matches.length === 1 ? matches[0]! : null;
        if (!node) return { id: pin.id, status: matches.length ? 'ambiguous' : 'missing', rect: { x: 0, y: 0, width: 0, height: 0 } };
        // A migrated block's quote is retained context, not a text selection.
        // Identity alone locates it even when its words changed or repeat.
        if(pin.anchor?.presentation==='block'){
          const rect=box(node.getBoundingClientRect()),active=input.openId===pin.id||input.hoverId===pin.id;
          if((rect.width!==0||rect.height!==0)&&!pin.layoutOnly&&(input.mode==='on'||active)){
            let painted=blockMarks.get(node);
            if(!painted){
              const mark=doc.createElement('div');
              painted={mark,active};blockMarks.set(node,painted);overlay.append(mark);
            }
            painted.active ||= active;
            const mark=painted.mark;
            mark.style.cssText=painted.active?COMMENT_PRESENTATION.blockStyle.activeCss:COMMENT_PRESENTATION.blockStyle.baseCss;
            Object.assign(mark.style,{...positioned(rect),width:`${rect.width}px`,height:`${rect.height}px`,background:'transparent',pointerEvents:'none'});
            if(painted.active)mark.style.boxShadow=COMMENT_PRESENTATION.blockStyle.activeInset;
          }
          return {id:pin.id,status:'exact',rect};
        }
        const ranges: Range[] = [];
        if(pin.anchor?.segments){
          if(!pin.anchor.segments.length)return {id:pin.id,status:'exact',rect:box(node.getBoundingClientRect())};
          for(const part of pin.anchor.segments){
            const targets=htmlAnchorElements(doc,part.nodeId);
            if(targets.length!==1)return {id:pin.id,status:targets.length?'ambiguous':'missing',rect:box(node.getBoundingClientRect())};
            const target=targets[0]!,text=target.textContent??'',range=part.range;
            if(text.length!==range.length || htmlTextFingerprint(text)!==range.fingerprint || text.slice(range.start,range.end).replace(/\s+/g,' ').trim()!==part.quote.replace(/\s+/g,' ').trim())return {id:pin.id,status:'missing',rect:box(node.getBoundingClientRect())};
            const partResolved=resolveHtmlRange(target,{...pin.anchor,nodeId:part.nodeId,quote:part.quote,range,segments:undefined},{endAffinity:part.endAffinity});
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
        const highlightApi=ranges.length && view?.CSS?.highlights && view.Highlight;
        if(!pin.layoutOnly && (input.mode==='on' || active) && highlightApi){
          const name='af-imported-comment-'+registered.size;
          view!.CSS!.highlights!.set(name,new view!.Highlight!(...ranges));registered.add(name);
          const style=doc.createElement('style');
          const fill=input.openId===pin.id?COMMENT_PRESENTATION.highlightFill.open:input.hoverId===pin.id?COMMENT_PRESENTATION.highlightFill.hover:COMMENT_PRESENTATION.highlightFill.base;
          style.textContent=`::highlight(${name}) { background-color: ${fill}; }`;overlay.append(style);
        }
        if (!highlightApi && !pin.layoutOnly && (input.mode === 'on' || active)) for (const rect of rects) {
          const mark = doc.createElement('div');
          Object.assign(mark.style, { ...positioned(rect), width: `${rect.width}px`, height: `${rect.height}px`, background: active ? 'rgba(59,130,246,.20)' : 'rgba(250,204,21,.20)', outline: active ? '1px solid rgba(59,130,246,.6)' : 'none', pointerEvents: 'none' });
          overlay.append(mark);
        }
        const rect = ranges.length ? (()=>{const boxes=ranges.map(range=>typeof range.getBoundingClientRect==='function'?range.getBoundingClientRect():node.getBoundingClientRect());const x=Math.min(...boxes.map(r=>r.x)),y=Math.min(...boxes.map(r=>r.y));return {x,y,width:Math.max(...boxes.map(r=>r.right))-x,height:Math.max(...boxes.map(r=>r.bottom))-y};})() : areaRect ?? (resolved?.range && typeof resolved.range.getBoundingClientRect === 'function' ? resolved.range.getBoundingClientRect() : node.getBoundingClientRect());
        return { id: pin.id, status: 'exact', rect: box(rect) };
      });
    },
    dispose: () => {clearHighlights();overlay.remove();},
  };
}
