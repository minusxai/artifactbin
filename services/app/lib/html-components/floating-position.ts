/**
 * Internal: anchors floating panels and orders nested overlays for Escape dismissal.
 * Used by: popover.ts, tooltip.ts, date-picker.ts.
 */
import {floatingPosition,type FloatingSide} from './floating-geometry';
export {floatingPosition} from './floating-geometry';
export type {FloatingSide,FloatingRect,FloatingPosition} from './floating-geometry';
/** Library lifecycle metadata only; shared across independently bundled entries. */
interface FloatingRegistry { overlays: HTMLElement[]; nextIdentity: number }
// Symbol.for joins separately bundled component entry points without putting viewer data
// on globals. The document owns this library-only registry and its connected overlays.
const REGISTRY = Symbol.for('af.html-components.floating.v1');
function registryFor(document: Document): FloatingRegistry {
 const owner = document as Document & {[key: symbol]: FloatingRegistry | undefined};
 let registry = owner[REGISTRY];
 if(!registry) {
  registry = {overlays:[],nextIdentity:0};
  Object.defineProperty(document,REGISTRY,{value:registry,configurable:true});
 }
 return registry;
}
export function identifyFloating(node: HTMLElement): void { if (!node.id) { let id: string; do {
  id = `af-floating-${++registryFor(node.ownerDocument).nextIdentity}`; } while(
  node.ownerDocument.getElementById(id)); node.id = id; } }
export function positionFloating(anchor: HTMLElement, panel: HTMLElement, defaultSide: FloatingSide,
  offset: number): void {
 const view = panel.ownerDocument.defaultView!;
 const requested = panel.getAttribute('side');
const side = requested === 'top' || requested === 'bottom' || requested === 'left' ||
   requested === 'right' ? requested : defaultSide;
 const raw = Number(panel.getAttribute('side-offset') ?? offset);
const point = floatingPosition(anchor.getBoundingClientRect(),panel.getBoundingClientRect(),{width:
   view.innerWidth,height:view.innerHeight},side,panel.getAttribute('align') ?? 'center',
   Number.isFinite(raw) ? Math.max(0,raw) : offset);
panel.style.left = `${point.left}px`; panel.style.top = `${point.top}px`; panel.dataset.side =
   point.side;
 panel.dataset.align = panel.getAttribute('align') ?? 'center';
}
/** Shared ordering allows nested tooltip/popover Escape to dismiss one overlay. */
export function floatingVisibility(node: HTMLElement, open: boolean): void {
 const registry = registryFor(node.ownerDocument);
 const stack = registry.overlays.filter(n => n.isConnected && n !== node);
 if (open) stack.push(node); registry.overlays = stack;
 if (open) node.ownerDocument.dispatchEvent(new CustomEvent('af-floating-activated',{detail:node}));
}
export function topFloating(node: HTMLElement): boolean {
 const registry = registryFor(node.ownerDocument);
 const stack = registry.overlays.filter(n => n.isConnected); registry.overlays = stack;
 return stack.filter(n => !stack.some(other => other !== n && n.contains(other))).at(-1) === node;
}
