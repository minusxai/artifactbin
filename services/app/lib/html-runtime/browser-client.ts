import { createClient, createLocalStore, gql, readStateFragment } from './apollo/client';
import type { HtmlJsonObject } from '@artifactbin/contracts';
import type { HtmlRuntimeConfig } from './contract';
import { RemoteUnreachable, type RemotePort, type StoreWrite } from './apollo/apollo-contracts';
export { gql };

declare const __AF_RUNTIME_CONFIG__: HtmlRuntimeConfig & { offline?: boolean };
const config = __AF_RUNTIME_CONFIG__;
const key = `af:viewer:${config.pageId}`;
let initial = config.initialState ?? {};
try { const saved = localStorage.getItem(key); if (saved) { const value = JSON.parse(saved) as HtmlJsonObject; createLocalStore(value); initial = value; } } catch { /* storage denied */ }
const carried = readStateFragment(location.hash);
if (carried.state) initial = carried.state;
const state = createLocalStore(initial);
const write = state.write;
state.write = async (change: StoreWrite) => {
  const result = await write(change);
  if (result.status === 'committed') try { localStorage.setItem(key, JSON.stringify(result.document)); } catch { /* storage denied */ }
  return result;
};
const remote: RemotePort = {
  online: () => !config.offline && !!config.appOrigin && window.parent !== window,
  execute: async () => { throw new RemoteUnreachable('Remote relay has not attached'); },
};
export const client = createClient({ backends: config.backends ?? [], state, remote });

import type { FrameBridgeAttach, FrameBridgeFramePayload, FrameBridgeParentPayload } from '../story-runtime/contract';
interface FrameBridgeStartOptions { win: Window; post: (payload: FrameBridgeFramePayload) => void; attach: FrameBridgeAttach }
interface FrameBridgeSession { receive(payload: FrameBridgeParentPayload): void; dispose(): void }
import { htmlSelection } from '../html-bridge/selection';
let relay: ((request: Parameters<RemotePort['execute']>[0]) => ReturnType<RemotePort['execute']>) | null = null;
remote.execute = (request) => relay ? relay(request) : Promise.reject(new RemoteUnreachable());

/** Original trusted frame door owns source/origin/key checks; this adapter supplies native HTML geometry. */
export function startFrameBridge({ win, post }: FrameBridgeStartOptions): FrameBridgeSession {
  const nonce = crypto.randomUUID();
  let call = 0;
  let canAnnotate = false;
  let pins: Array<{ id: string; nodeId?: string | null; path: string }> = [];
  const layout = () => post({ kind: 'event', event: { type: 'mx:annotation-layout', nonce, positions: pins.map((pin) => {
          const target = [...win.document.querySelectorAll('[data-af-id]')].find((node) => node.getAttribute('data-af-id') === (pin.nodeId ?? pin.path));
          const rect = target?.getBoundingClientRect();
          return { id: pin.id, status: target ? 'exact' : 'missing', rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : { x: 0, y: 0, width: 0, height: 0 } };
        }) } });
  const click = (event: MouseEvent) => {
    const target = (event.target as Element)?.closest?.('[data-af-id]');
    const pin = pins.find((item) => (item.nodeId ?? item.path) === target?.getAttribute('data-af-id'));
    if (pin && target) { const rect = target.getBoundingClientRect(); post({ kind: 'event', event: { type: 'mx:annotation-pin', nonce, id: pin.id, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } }); }
  };
  const pending = new Map<number, { resolve: (value: Awaited<ReturnType<RemotePort['execute']>>) => void; reject: (error: Error) => void }>();
  relay = (request) => new Promise((resolve, reject) => {
    const id = ++call;
    pending.set(id, { resolve, reject });
    post({ kind: 'fetch', call: id, path: `/api/pages/${encodeURIComponent(config.pageId)}/graphql`, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  });
  const selection = () => post({ kind: 'event', event: { type: 'mx:selection', nonce, selection: htmlSelection(win, undefined, config.revision) } });
  const context = (event: MouseEvent) => {
    if (!canAnnotate) return;
    const selected = htmlSelection(win, event.target as Node, config.revision);
    if (selected) { event.preventDefault(); post({ kind: 'event', event: { type: 'mx:selection-action', nonce, action: 'select', selection: selected } }); }
  };
  const scroll = () => { post({ kind: 'scroll', scrollX: win.scrollX, scrollY: win.scrollY }); selection(); if (pins.length) layout(); };
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
        const command = payload.command as { type?: string; annotate?: boolean; pins?: Array<{ id: string; nodeId?: string | null; path: string }> };
        if (command?.type === 'mx:selection-actions') canAnnotate = command.annotate === true;
        if (command?.type === 'mx:annotations') pins = command.pins ?? [];
        if (command?.type === 'mx:annotations') layout();
      }
    },
    dispose() {
      relay = null;
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
