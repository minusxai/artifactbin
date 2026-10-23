import { runtimeId } from '@artifactbin/utils/runtime-id';
import { createClient, gql, readStateFragment } from './apollo/client';
import { createViewerState } from './viewer-state';
import type { HtmlRuntimeConfig } from './contract';
import { RemoteUnreachable, type RemotePort, type StoreReceipt } from './apollo/apollo-contracts';
export { gql };

declare const __AF_RUNTIME_CONFIG__: HtmlRuntimeConfig & { offline?: boolean };
const config = __AF_RUNTIME_CONFIG__;
const key = `af:viewer:${config.pageId}`;
const carried = readStateFragment(location.hash);
const state = createViewerState({
  initial: carried.state ?? config.initialState ?? {}, replaceInitial: !!carried.state,
  storage: { read: () => localStorage.getItem(key), write: (json) => localStorage.setItem(key, json) },
  observe(listener) { const changed = (event: StorageEvent) => { if (event.key === key) listener(); }; addEventListener('storage', changed); return () => removeEventListener('storage', changed); },
  ...(navigator.locks ? { lock: (work: () => Promise<StoreReceipt>) => navigator.locks.request(key, work) } : {}),
});
const remote: RemotePort = {
  online: () => !config.offline && !!config.appOrigin && window.parent !== window,
  execute: async () => { throw new RemoteUnreachable('Remote relay has not attached'); },
};
const invalidationListeners = new Set<(names: readonly string[]) => void>();
/** An invalidation contains names, never rows. Authors explicitly query again; watchQuery stays local-only. */
export function onBackendChange(listener: (names: readonly string[]) => void): { unsubscribe(): void } { invalidationListeners.add(listener); return { unsubscribe: () => { invalidationListeners.delete(listener); } }; }
export const client = createClient({ backends: config.backends ?? [], state, remote });

import type { FrameBridgeAttach, FrameBridgeFramePayload, FrameBridgeParentPayload } from '../story-runtime/contract';
interface FrameBridgeStartOptions { win: Window; post: (payload: FrameBridgeFramePayload) => void; attach: FrameBridgeAttach }
interface FrameBridgeSession { receive(payload: FrameBridgeParentPayload): void; dispose(): void }
import {observeHtmlDom} from '../html-bridge/observe';
import { htmlSelection } from '../html-bridge/selection';
import { createHtmlAnnotationPainter, htmlAnchorElements, type HtmlAnnotationPaint } from '../html-bridge/annotations';
let relay: ((request: Parameters<RemotePort['execute']>[0]) => ReturnType<RemotePort['execute']>) | null = null;
const relayWaiters = new Set<() => void>();
remote.execute = async (request) => {
  if (!relay) await new Promise<void>((resolve, reject) => {
    const ready = () => { clearTimeout(timer); relayWaiters.delete(ready); resolve(); };
    const timer = setTimeout(() => { relayWaiters.delete(ready); reject(new RemoteUnreachable('Page connection did not attach')); }, 3000);
    relayWaiters.add(ready);
  });
  if (!relay) throw new RemoteUnreachable();
  return relay(request);
};

/** Original trusted frame door owns source/origin/key checks; this adapter supplies native HTML geometry. */
export function startFrameBridge({ win, post }: FrameBridgeStartOptions): FrameBridgeSession {
  const nonce = runtimeId();
  let call = 0;
  let canAnnotate = false;
  let annotations: HtmlAnnotationPaint = { pins: [], mode: 'off', openId: null, hoverId: null };
  const painter = createHtmlAnnotationPainter(win.document);
  let pick: 'block' | 'area' | 'select' | null = null;
  const cursor = win.document.documentElement.style.cursor;
  let suppressClick = false;
  let drag: { x: number; y: number; target: Node } | null = null;
  const layout = () => post({ kind: 'event', event: { type: 'mx:annotation-layout', nonce, positions: painter.paint(annotations) } });
  const observation=observeHtmlDom(win,painter.ownsOverlay,()=>{if(annotations.pins.length)layout();});
  const click = (event: MouseEvent) => {
    if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
    const target = (event.target as Element)?.closest?.('[data-af-id]');
    if (pick && canAnnotate) { event.preventDefault(); const selected = htmlSelection(win, target, config.revision, config.savedNodeIds); if (selected) post({ kind: 'event', event: { type: 'mx:selection', nonce, selection: selected } }); return; }
    const pin = annotations.pins.find((item) => { const matches=htmlAnchorElements(win.document,item.anchor?.nodeId ?? item.nodeId ?? item.path,item.anchor?.ancestorId); return matches.length===1 && matches[0]===target; });
    if (pin && target) { const rect = target.getBoundingClientRect(); post({ kind: 'event', event: { type: 'mx:annotation-pin', nonce, id: pin.id, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } }); }
  };
  const pending = new Map<number, { resolve: (value: Awaited<ReturnType<RemotePort['execute']>>) => void; reject: (error: Error) => void }>();
  relay = (request) => new Promise((resolve, reject) => {
    const id = ++call;
    pending.set(id, { resolve, reject });
    post({ kind: 'fetch', call: id, path: `/api/artifacts/${encodeURIComponent(config.pageId)}/graphql`, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  });
  for (const ready of [...relayWaiters]) ready();
  const selection = () => post({ kind: 'event', event: { type: 'mx:selection', nonce, selection: htmlSelection(win, undefined, config.revision, config.savedNodeIds) } });
  const context = (event: MouseEvent) => {
    if (!canAnnotate) return;
    const selected = htmlSelection(win, event.target as Node, config.revision, config.savedNodeIds);
    if (selected) { event.preventDefault(); post({ kind: 'event', event: { type: 'mx:selection-action', nonce, action: 'select', selection: selected } }); }
  };
  const scroll = () => { post({ kind: 'scroll', scrollX: win.scrollX, scrollY: win.scrollY }); selection(); if (annotations.pins.length) layout(); };
  const down = (event: PointerEvent) => { if (pick && canAnnotate) drag = { x: event.clientX, y: event.clientY, target: event.target as Node }; };
  const up = (event: PointerEvent) => {
    const start = drag; drag = null;
    if (!start || !pick || !canAnnotate || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
    suppressClick = true;
    if (win.getSelection()?.toString().trim()) { selection(); return; }
    let node = start.target.nodeType === 1 ? start.target as Element : start.target.parentElement;
    while (node && !node.contains(event.target as Node)) node = node.parentElement;
    const selected = htmlSelection(win, node, config.revision, config.savedNodeIds);
    if (!selected) return;
    const rect = selected.rect;
    const x = Math.max(rect.x, Math.min(start.x, event.clientX)), y = Math.max(rect.y, Math.min(start.y, event.clientY));
    const width = Math.min(rect.x + rect.width, Math.max(start.x, event.clientX)) - x, height = Math.min(rect.y + rect.height, Math.max(start.y, event.clientY)) - y;
    if (width > 0 && height > 0 && rect.width > 0 && rect.height > 0) post({ kind: 'event', event: { type: 'mx:selection', nonce, selection: { ...selected, captureRect: { x, y, width, height }, range: { v: 1, kind: 'area', box: { x: (x - rect.x) / rect.width, y: (y - rect.y) / rect.height, w: width / rect.width, h: height / rect.height } } } } });
  };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && pick) { pick = null; win.document.documentElement.style.cursor = cursor; post({ kind: 'event', event: { type: 'mx:selection', nonce, selection: null } }); } };
  win.document.addEventListener('keydown', key);
  win.document.addEventListener('pointerdown', down);
  win.document.addEventListener('pointerup', up);
  win.document.addEventListener('click', click);
  win.document.addEventListener('selectionchange', selection);
  win.document.addEventListener('contextmenu', context);
  win.addEventListener('scroll', scroll, { passive: true });
  win.addEventListener('resize', layout);
  post({ kind: 'ready', nonce });
  return {
    receive(payload) {
      if (payload.kind === 'restored') post({ kind: 'restored', call: payload.call, ok: true });
      if (payload.kind === 'fetch-result') {
        const current = pending.get(payload.call);
        if (!current) return;
        pending.delete(payload.call);
        if ('error' in payload) current.reject(new Error('Remote request outcome unknown'));
        else try { current.resolve(JSON.parse(payload.body)); } catch { current.reject(new Error('Invalid remote reply; outcome unknown')); }
      }
      if (payload.kind === 'send') {
        const command = payload.command as Partial<HtmlAnnotationPaint> & { type?: string; annotate?: boolean; canComment?: boolean; pick?: typeof pick; path?: string | null; reveal?: boolean; datasets?: string[] };
        if (command?.type === 'mx:data' && Array.isArray(command.datasets)) { const ids = new Set(command.datasets); const names = config.backends.filter((name) => ids.has(name) || ids.has(config.bindings?.[name] ?? '')); if (names.length) for (const listener of invalidationListeners) try { listener(names); } catch { /* One subscriber cannot stop the others. */ } }
        if (command?.type === 'mx:selection-actions') canAnnotate = command.annotate === true;
        if (command?.type === 'mx:annotations') { annotations = { pins: command.pins ?? [], mode: command.mode ?? 'off', openId: command.openId ?? null, hoverId: command.hoverId ?? null }; canAnnotate = command.canComment ?? canAnnotate; pick = command.pick ?? null; win.document.documentElement.style.cursor = pick ? 'crosshair' : cursor; }
        if (command?.type === 'mx:select') { const matches = [...win.document.querySelectorAll('[data-af-id]')].filter((node) => node.getAttribute('data-af-id') === command.path); const target = matches.length===1 ? matches[0] : null; const selected = target ? htmlSelection(win, target, config.revision, config.savedNodeIds) : null; if (command.reveal) target?.scrollIntoView?.(); post({ kind: 'event', event: { type: 'mx:selection', nonce, selection: selected } }); }
        if (command?.type === 'mx:annotations') layout();
      }
    },
    dispose() {
      relay = null;
      observation.dispose();
      painter.dispose();
      win.document.documentElement.style.cursor = cursor;
      win.document.removeEventListener('keydown', key);
      win.document.removeEventListener('pointerdown', down);
      win.document.removeEventListener('pointerup', up);
      for (const entry of pending.values()) entry.reject(new Error('Frame closed; remote outcome unknown'));
      pending.clear();
      win.document.removeEventListener('click', click);
      win.document.removeEventListener('selectionchange', selection);
      win.document.removeEventListener('contextmenu', context);
      win.removeEventListener('scroll', scroll);
      win.removeEventListener('resize', layout);
    },
  };
}
