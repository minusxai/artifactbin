import { createLocalDatasetTransport } from './browser-local-datasets';
import { startPortableSession } from './portable-session';
import { createHtmlSelectionActions } from './selection-actions';
import {createHtmlCommentViewSession} from '../html-bridge/comment-view-session';
import type {HtmlCommentViewCommand} from '../html-bridge/comment-view-contract';
import {startHtmlPresence} from '../html-bridge/presence';
import type {PresencePaint} from '../html-presence/contract';
import {followAppLinks} from '@/lib/islands/frame-links';
import {runtimeId} from '@artifactbin/utils/runtime-id';
import type {HtmlRuntimeConfig} from './contract';
import {RemoteUnreachable,type RemotePort} from './apollo/apollo-contracts';
declare const __AF_RUNTIME_CONFIG__:HtmlRuntimeConfig&{offline?:boolean};
export const config=__AF_RUNTIME_CONFIG__;
const preview=config.localPreview?createLocalDatasetTransport({privatePreview:document.documentElement.hasAttribute('data-af-private-preview'),endpoint:config.localPreview.endpoint},location,fetch):undefined;
export const remote: RemotePort = {
  online: () => preview?.online()===true || !config.offline && !!config.appOrigin && window.parent !== window,
  execute: async () => { throw new RemoteUnreachable('Remote relay has not attached'); },
};
const invalidationListeners = new Set<(names: readonly string[]) => void>();
/** An invalidation contains names, never rows. Authors explicitly query again; watchQuery stays local-only. */
export function onBackendChange(listener: (names: readonly string[]) => void): { unsubscribe(): void } { invalidationListeners.add(listener); return { unsubscribe: () => { invalidationListeners.delete(listener); } }; }
import type { FrameBridgeAttach, FrameBridgeFramePayload, FrameBridgeParentPayload } from '../story-runtime/contract';
interface FrameBridgeStartOptions { win: Window; post: (payload: FrameBridgeFramePayload) => void; attach?: FrameBridgeAttach }
interface FrameBridgeSession { receive(payload: FrameBridgeParentPayload): void; dispose(): void }
import {observeHtmlDom} from '../html-bridge/observe';
import { htmlSelection } from '../html-bridge/selection';
import { revealHtmlAnnotation, createHtmlAnnotationPainter, type HtmlAnnotationPaint } from '../html-bridge/annotations';
let relay: ((request: Parameters<RemotePort['execute']>[0]) => ReturnType<RemotePort['execute']>) | null = null;
const relayWaiters = new Set<() => void>();
remote.execute = async (request) => {
  if(preview?.online())return preview.execute(request);
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
  const stopLinks = config.appOrigin ? followAppLinks(win, config.appOrigin) : () => {};
  const nonce = runtimeId();
  let call = 0;
  let canAnnotate = false;
  let annotations: HtmlAnnotationPaint = { pins: [], mode: 'off', openId: null, hoverId: null };
  const painter = createHtmlAnnotationPainter(win.document);
  const commentView = createHtmlCommentViewSession(win.document);
  const presence = startHtmlPresence(win, geometry => post({kind:'event',event:{type:'mx:presence',nonce,geometry}}));
  let pick: 'block' | 'area' | 'select' | null = null;
  const cursor = win.document.documentElement.style.cursor;
  let suppressClick = false;
  let drag: { x: number; y: number; target: Node } | null = null;
  const layout = () => post({ kind: 'event', event: { type: 'mx:annotation-layout', nonce, positions: painter.paint(annotations), viewStateError: commentView.error } });
  const actions = createHtmlSelectionActions({ win, capture: target => htmlSelection(win, target, config.revision, config.savedNodeIds), onAction: (action, selected) => post({ kind: 'event', event: { type: 'mx:selection-action', nonce, action, selection: selected } }) });
  const observation=observeHtmlDom(win,node=>painter.ownsOverlay(node)||presence.ownsOverlay(node)||actions.ownsOverlay(node),()=>{if(annotations.pins.length)layout();presence.paint();});
  const click = (event: MouseEvent) => {
    if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
    const target = (event.target as Element)?.closest?.('[data-af-id]');
    if (pick && canAnnotate) { event.preventDefault(); const selected = htmlSelection(win, target, config.revision, config.savedNodeIds); if (selected) post({ kind: 'event', event: { type: 'mx:selection', nonce, selection: selected } }); return; }

  };
  const pending = new Map<number, { resolve: (value: Awaited<ReturnType<RemotePort['execute']>>) => void; reject: (error: Error) => void }>();
  relay = (request) => new Promise((resolve, reject) => {
    const id = ++call;
    pending.set(id, { resolve, reject });
    post({ kind: 'fetch', call: id, path: `/api/artifacts/${encodeURIComponent(config.pageId)}/graphql`, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  });
  for (const ready of [...relayWaiters]) ready();
  const selection = () => {
    if (pick === 'area' || !win.getSelection()?.toString().trim()) return;
    post({ kind: 'event', event: { type: 'mx:selection', nonce, selection: htmlSelection(win, undefined, config.revision, config.savedNodeIds) } });
  };
  const scroll = () => { post({ kind: 'scroll', scrollX: win.scrollX, scrollY: win.scrollY }); selection(); if (annotations.pins.length) layout(); };
  const down = (event: PointerEvent) => {
    if (!pick || !canAnnotate) return;
    if (pick === 'area') { event.preventDefault(); win.getSelection()?.removeAllRanges(); }
    drag = { x: event.clientX, y: event.clientY, target: event.target as Node };
  };
  const up = (event: PointerEvent) => {
    const start = drag; drag = null;
    if (!start || !pick || !canAnnotate || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
    suppressClick = true;
    if (pick !== 'area' && win.getSelection()?.toString().trim()) { selection(); return; }
    if (pick === 'area') win.getSelection()?.removeAllRanges();
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
        const command = payload.command as Partial<HtmlAnnotationPaint> & HtmlCommentViewCommand & { type?: string; annotate?: boolean; canComment?: boolean; pick?: typeof pick; path?: string | null; reveal?: boolean; datasets?: string[] };
        if (command?.type === 'mx:presence') presence.receive(payload.command as PresencePaint);
        if (command?.type === 'mx:data' && Array.isArray(command.datasets)) { const ids = new Set(command.datasets); const names = config.backends.filter((name) => ids.has(name) || ids.has(config.bindings?.[name] ?? '')); if (names.length) for (const listener of invalidationListeners) try { listener(names); } catch { /* One subscriber cannot stop the others. */ } }
        if (command?.type === 'mx:selection-actions') canAnnotate = command.annotate === true;
        if (command?.type === 'mx:annotations') { annotations = { pins: command.pins ?? [], mode: command.mode ?? 'off', openId: command.openId ?? null, hoverId: command.hoverId ?? null }; canAnnotate = command.canComment ?? canAnnotate; pick = command.pick ?? null; win.document.documentElement.style.cursor = pick ? 'crosshair' : cursor; }
        if (command?.type === 'mx:select') { const matches = [...win.document.querySelectorAll('[data-af-id]')].filter((node) => node.getAttribute('data-af-id') === command.path); const target = matches.length===1 ? matches[0] : null; const selected = target ? htmlSelection(win, target, config.revision, config.savedNodeIds) : null; if (command.reveal) target?.scrollIntoView?.(); post({ kind: 'event', event: { type: 'mx:selection', nonce, selection: selected } }); }
        if (command?.type === 'mx:annotations' || command?.type === 'mx:selection-actions') actions.update(canAnnotate && !pick);
        if (command?.type === 'mx:annotations') void commentView.receive(command).then(changed => { const pin = annotations.pins.find(pin => pin.id === annotations.openId); if(changed && pin) revealHtmlAnnotation(win.document,pin); layout(); });
      }
    },
    dispose() {
      stopLinks();
      relay = null;
      observation.dispose();
      painter.dispose();
      actions.dispose();
      presence.dispose();
      win.document.documentElement.style.cursor = cursor;
      win.document.removeEventListener('keydown', key);
      win.document.removeEventListener('pointerdown', down);
      win.document.removeEventListener('pointerup', up);
      for (const entry of pending.values()) entry.reject(new Error('Frame closed; remote outcome unknown'));
      pending.clear();
      win.document.removeEventListener('click', click);
      win.document.removeEventListener('selectionchange', selection);
      win.removeEventListener('scroll', scroll);
      win.removeEventListener('resize', layout);
    },
  };
}

/** Downloads attach only a credential-free document transport; no source upload occurs. */
export function startPortableDocument(win:Window=window):()=>void {
 let connected=false;
 let execute:Parameters<Parameters<typeof startPortableSession>[0]['online']>[1];
 const originalOnline=remote.online,originalExecute=remote.execute;
 remote.online=()=>connected||originalOnline();
 remote.execute=request=>connected&&execute?execute(request) as ReturnType<RemotePort['execute']>:originalExecute(request);
 return startPortableSession({win,attach:post=>startFrameBridge({win,post}),online(value,request){connected=value;execute=request;}});
}
