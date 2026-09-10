import type { ManagedCommentEvent, ManagedCommentState } from './managed-comment-contract';
import { parseCommentTarget } from '@/lib/story/comment-target';
import { canonicalQuote, parseAnnotationRange, isTargetRange, type AnnotationRect } from '@/lib/story/annotation-range';

type Host = { element: HTMLElement; generation: string; send(state: ManagedCommentState): void; state: ManagedCommentState };
type Consumer = { state(host: HTMLElement): Omit<ManagedCommentState, 'generation' | 'type'>; receive(host: HTMLElement, event: ManagedCommentEvent): void };
const registries = new WeakMap<Document, {hosts: Set<Host>; consumer: Consumer | null}>();
const registry = (doc: Document) => { let r = registries.get(doc); if (!r) {r = {hosts: new Set(), consumer: null}; registries.set(doc, r);} return r; };
const disabled = (): Omit<ManagedCommentState, 'generation' | 'type'> => ({enabled:false,picking:false,canComment:false,pins:[],openId:null,hoverId:null,selection:null});
const rect = (value: unknown): value is AnnotationRect => {
  if (!value || typeof value !== 'object') return false;
  const r = value as AnnotationRect;
  return [r.x,r.y,r.width,r.height].every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7) && r.width >= 0 && r.height >= 0;
};
export function translateManagedRect(host: HTMLElement, value: AnnotationRect): AnnotationRect {
  const bounds = host.getBoundingClientRect();
  const sx = host.offsetWidth ? bounds.width / host.offsetWidth : 1;
  const sy = host.offsetHeight ? bounds.height / host.offsetHeight : 1;
  const width = host.clientWidth || bounds.width / sx;
  const height = host.clientHeight || bounds.height / sy;
  const x = Math.max(0,Math.min(width,value.x));
  const y = Math.max(0,Math.min(height,value.y));
  const right = Math.max(x,Math.min(width,value.x+value.width));
  const bottom = Math.max(y,Math.min(height,value.y+value.height));
  return {x:bounds.x + (host.clientLeft + x) * sx,y:bounds.y + (host.clientTop + y) * sy,width:(right-x)*sx,height:(bottom-y)*sy};
}
export function bindManagedComments(doc: Document, consumer: Consumer): {sync(): void; dispose(): void} {
  const r = registry(doc); r.consumer = consumer;
  const sync = () => { for (const host of r.hosts) {const next: ManagedCommentState = {type:'comment-state',generation:host.generation,...consumer.state(host.element)}; if (JSON.stringify(next) !== JSON.stringify(host.state)) {host.state = next; host.send(next);}} };
  sync();
  return {sync,dispose() {if (r.consumer !== consumer) return; r.consumer = null; for (const host of r.hosts) {host.state={type:'comment-state',generation:host.generation,...disabled()};host.send(host.state);}}};
}
export function connectManagedComments(input: HTMLElement, send: (state: ManagedCommentState) => void): {receive(message: unknown): void; dispose(): void} {
  const element = input.closest<HTMLElement>('[data-mx-managed-frame]') ?? input;
  const r = registry(element.ownerDocument);
  const generation = crypto.randomUUID();
  const host: Host = {element,generation,send,state:{type:'comment-state',generation,...(r.consumer?.state(element) ?? disabled())}};
  r.hosts.add(host); send(host.state);
  let disposed = false;
  return {
    receive(message) {
      if (disposed || !element.isConnected || !r.consumer || !host.state.enabled || !message || typeof message !== 'object') return;
      const raw = message as Record<string, unknown>;
      if (raw.generation !== generation) return;
      const idValid = (id: unknown) => typeof id === 'string' && host.state.pins.some((pin) => pin.id === id);
      let event: ManagedCommentEvent;
      if (raw.type === 'comment-selection') {
        if (!host.state.canComment) return;
        if (raw.selection === null) event = {type:raw.type,generation,selection:null};
        else {
          if (!raw.selection || typeof raw.selection !== 'object') return;
          const selection = raw.selection as Record<string, unknown>;
          const target = parseCommentTarget({kind:'iframe',node:selection.target});
          if (!target || target.kind !== 'iframe' || !rect(selection.rect)) return;
          if (target.node.kind === 'session' && target.node.generation !== generation) return;
          const range = selection.range === undefined ? undefined : parseAnnotationRange(selection.range);
          if (selection.range !== undefined && (!range || isTargetRange(range))) return;
          if (selection.quote !== undefined && (typeof selection.quote !== 'string' || selection.quote.length > 2000)) return;
          event={type:raw.type,generation,selection:{target:target.node,rect:translateManagedRect(element, selection.rect),...(range && !isTargetRange(range) ? {range}:{}),...(typeof selection.quote === 'string' ? {quote:canonicalQuote(selection.quote)}:{})}};
        }
      } else if (raw.type === 'comment-layout') {
        if (!Array.isArray(raw.positions) || raw.positions.length > 1000) return;
        const positions: Extract<ManagedCommentEvent,{type:'comment-layout'}>['positions'] = [];
        for (const item of raw.positions) {
          if (!item || !idValid(item.id) || !rect(item.rect) || !['exact','missing','ambiguous'].includes(item.status)) return;
          positions.push({id:item.id,rect:translateManagedRect(element,item.rect),status:item.status});
        }
        if (raw.selectionRect !== undefined && raw.selectionRect !== null && !rect(raw.selectionRect)) return;
        event={type:raw.type,generation,positions,...(raw.selectionRect !== undefined ? {selectionRect:raw.selectionRect === null ? null : translateManagedRect(element,raw.selectionRect as AnnotationRect)}:{})};
      } else if (raw.type === 'comment-hover') {
        if (raw.id !== null && !idValid(raw.id)) return;
        event={type:raw.type,generation,id:raw.id as string|null};
      } else if (raw.type === 'comment-pin') {
        if (!idValid(raw.id) || !rect(raw.rect)) return;
        event={type:raw.type,generation,id:raw.id as string,rect:translateManagedRect(element,raw.rect)};
      } else if (raw.type === 'comment-select-mode' && host.state.canComment) event={type:raw.type,generation};
      else return;
      r.consumer.receive(element,event);
    },
    dispose() {disposed=true;r.hosts.delete(host);r.consumer?.receive(element,{type:'comment-layout',generation,positions:host.state.pins.map((pin)=>({id:pin.id,status:'missing',rect:element.getBoundingClientRect()}))});send({type:'comment-state',generation,...disabled()});},
  };
}

/** Inverse of viewport mapping for state replay; the child remeasures its target. */
export function localManagedRect(host: HTMLElement, rect: AnnotationRect): AnnotationRect {
  const bounds=host.getBoundingClientRect();
  const sx=host.offsetWidth ? bounds.width/host.offsetWidth : 1;
  const sy=host.offsetHeight ? bounds.height/host.offsetHeight : 1;
  return {x:(rect.x-bounds.x)/(sx || 1)-host.clientLeft,y:(rect.y-bounds.y)/(sy || 1)-host.clientTop,width:rect.width/(sx || 1),height:rect.height/(sy || 1)};
}
