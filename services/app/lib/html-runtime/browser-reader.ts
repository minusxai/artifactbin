import {applyHtmlReaderAppearance} from '../html-bridge/reader';
import {createUploadContext,bindUploadControl} from './upload-context';
import type {UploadContext} from '@artifactbin/contracts';
import type {PlatformUploadControl} from './upload-contract';
import {createFileUploader} from './upload';
import {createUploadRelay} from './upload-relay';
import {createQueryReadiness} from './query-readiness';
import { createLocalDatasetTransport } from './browser-local-datasets';
import { createHtmlSelectionActions } from './selection-actions';
import {createHtmlCommentViewSession} from '../html-bridge/comment-view-session';
import type {HtmlCommentViewCommand} from '../html-bridge/comment-view-contract';
import {startHtmlPresence} from '../html-bridge/presence';
import type {PresencePaint} from '../html-presence/contract';
import {followAppLinks} from '@/lib/islands/frame-links';
import {runtimeId} from '@artifactbin/utils/runtime-id';
import type {HtmlRuntimeConfig} from './contract';
import {HTML_VERSION_APPLIED,HTML_VERSION_MESSAGE,HTML_VERSION_REFUSED} from './live-morph-contract';
/** The live morph is its own content-addressed module (build.server `@afbin/morph`), fetched only when a version arrives. */
const MORPH_MODULE='@afbin/morph';
const loadLiveMorph=()=>import(/* @vite-ignore */ MORPH_MODULE) as Promise<typeof import('./live-morph')>;
import {RemoteUnreachable,type RemotePort,type QueryInvalidation} from './apollo/apollo-contracts';
declare const __AF_RUNTIME_CONFIG__:HtmlRuntimeConfig&{offline?:boolean};
export const config=__AF_RUNTIME_CONFIG__;
/** Portable remote access stays read-only regardless of connection state; local preview datasets are separate. */
export const remoteReadOnly=config.offline===true&&!config.localPreview;
function sourceNamespaces(document:Document):{names:string[];bindings:Record<string,string>}{
 const names:string[]=[],bindings:Record<string,string>={};
 for(const link of document.querySelectorAll('link[data-af-name]')){
  const rel=(link.getAttribute('rel')??'').split(/\s+/),name=link.getAttribute('data-af-name')??'';
  if(!rel.some(value=>value==='af-backend'||value==='af-dataset')||!/^[_A-Za-z][_0-9A-Za-z]*$/.test(name)||name.startsWith('__')||names.includes(name))continue;
  names.push(name);const id=/^ref:([A-Za-z0-9_-]+)$/.exec(link.getAttribute('href')??'')?.[1];if(id)bindings[name]=id;
 }
 return {names,bindings};
}
if(!config.backends.length)config.backends=sourceNamespaces(document).names;
const preview=config.localPreview?createLocalDatasetTransport({privatePreview:document.documentElement.hasAttribute('data-af-private-preview'),endpoint:config.localPreview.endpoint},location,fetch):undefined;
function pendingPortableConnection():boolean {
 if(!config.offline||document.documentElement.hasAttribute('data-af-private-preview'))return false;
 try{const identity=JSON.parse(document.querySelector('script[data-af="portable"]')?.textContent??'{}').identity;if(!identity)return false;try{return localStorage.getItem(`af:offline:${identity.platformOrigin}:${identity.artifactId}`)!=='true';}catch{return true;}}catch{return false;}
}
const portableReadiness=createQueryReadiness({pending:pendingPortableConnection(),schedule:(callback,delay)=>window.setTimeout(callback,delay),cancel:handle=>window.clearTimeout(handle as number)});
export const remote: RemotePort = {
  subscribe(listener){const subscription=onBackendChange((_names,reason)=>listener(reason));return()=>subscription.unsubscribe();},
  online: () => portableReadiness.online() || preview?.online()===true || !config.offline && !!config.appOrigin && window.parent !== window,
  whenReady:()=>{if(portableReadiness.pending())void startPortableDocument().catch(()=>{});return portableReadiness.wait();},
  execute: async () => { throw new RemoteUnreachable('Remote relay has not attached'); },
};
const invalidationListeners = new Set<(names: readonly string[],reason?:QueryInvalidation) => void>();
/** An invalidation contains names, never rows or authority. Backend watches re-query through the same trusted relay. */
export function onBackendChange(listener: (names: readonly string[],reason?:QueryInvalidation) => void): { unsubscribe(): void } { invalidationListeners.add(listener); return { unsubscribe: () => { invalidationListeners.delete(listener); } }; }
import type { FrameBridgeAttach, FrameBridgeFramePayload, FrameBridgeParentPayload } from '../story-runtime/contract';
interface FrameBridgeStartOptions { win: Window; post: (payload: FrameBridgeFramePayload) => void; attach?: FrameBridgeAttach }
interface FrameBridgeSession { receive(payload: FrameBridgeParentPayload): void; dispose(): void }
import {observeHtmlDom,observeSourceAnnotations} from '../html-bridge/observe';
import {startSourceAnnotationReadiness} from '../html-bridge/imported-observation';
import { htmlSelection } from '../html-bridge/selection';
import { revealHtmlAnnotation, createHtmlAnnotationPainter, type HtmlAnnotationPaint } from '../html-bridge/annotations';
let relay: ((request: Parameters<RemotePort['execute']>[0]) => ReturnType<RemotePort['execute']>) | null = null;
const relayWaiters = new Set<() => void>();
const uploadContext=createUploadContext(config.offline===true);
export const watchUploadContext=uploadContext.watch;
let uploads:ReturnType<typeof createUploadRelay>|undefined;
const uploader=createFileUploader({readOnly:()=>config.offline===true,datasetId:name=>config.bindings?.[name],send:(request,signal)=>{if(!uploads)return Promise.reject(Error('Page connection unavailable; reload and retry'));if(uploadContext.read().state!=='signed-in')return Promise.reject(Error('Uploads unavailable for this session'));return uploads.send(request,signal).then(result=>({...result,url:new URL(result.url,config.appOrigin).href}));}});
export async function uploadFile(file:File,options:import('./upload-contract').FileUploadOptions){
 if(!uploads)throw Error('Page connection unavailable; reload and retry');
 const initial=uploadContext.read();if(initial.state!=='signed-in')throw Error('Uploads unavailable for this session');
 const controller=new AbortController();
 const cancel=()=>controller.abort(options.signal?.reason);
 if(options.signal?.aborted)cancel();else options.signal?.addEventListener('abort',cancel,{once:true});
 const subscription=watchUploadContext(next=>{if(next.scope!==initial.scope||next.state!==initial.state)controller.abort(Error('Upload session changed; retry the same File to recover its outcome'));});
 try{return await uploader.upload(file,{...options,signal:controller.signal});}
 finally{subscription.unsubscribe();options.signal?.removeEventListener('abort',cancel);}
}
/** Installs the real platform port and session availability; dataset grants are still checked by the server. */
export function bindFileUpload(control:PlatformUploadControl,options:{disabled?:boolean;helperText?:string}={}){
 return bindUploadControl(control,{upload:uploadFile,fileUrl(file,dataset){
  const id=config.bindings?.[dataset],match=/^dfile:([a-z0-9]+)$/.exec(file.ref);
  if(!id||!match||!config.appOrigin)throw Error('File URL unavailable');
  return new URL(`/a/${encodeURIComponent(config.pageId)}/datasets/${encodeURIComponent(id)}/files/${match[1]}`,config.appOrigin).href;
 }},watchUploadContext,options);
}
export type {FileUploadOptions} from './upload-contract';
let connectedBefore=false;
remote.execute = async (request) => {
  if(portableReadiness.online())return portableReadiness.execute(request);
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
export function startFrameBridge({ win, post, attach }: FrameBridgeStartOptions): FrameBridgeSession {
  const stopLinks = config.appOrigin ? followAppLinks(win, config.appOrigin) : () => {};
  const nonce = runtimeId();
  let call = 0;
  let uploadSession=createUploadRelay(post,()=>++call);uploads=uploadSession;
  const updateUploadContext=(context:UploadContext)=>{
    if(uploads!==uploadSession)return;
    const old=uploadContext.read();
    if(old.scope!==context.scope||old.state!==context.state){uploadSession.dispose();uploadSession=createUploadRelay(post,()=>++call);uploads=uploadSession;}
    uploadContext.update(context);
  };
  updateUploadContext(attach?.uploadContext??{state:'unavailable',scope:nonce});
  let canAnnotate = false;
  let annotations: HtmlAnnotationPaint = { pins: [], mode: 'off', openId: null, hoverId: null };
  const sourceObservation=config.annotationObservation==='imported-source-v1';
  const painter = createHtmlAnnotationPainter(win.document,{coordinateSpace:sourceObservation?'document':'viewport',blockPresentation:sourceObservation?'source-node':'overlay'});
  const commentView = createHtmlCommentViewSession(win.document);
  const presence = startHtmlPresence(win, geometry => post({kind:'event',event:{type:'mx:presence',nonce,geometry}}));
  let pick: 'block' | 'area' | 'select' | null = null;
  const cursor = win.document.documentElement.style.cursor;
  let suppressClick = false;
  let drag: { x: number; y: number; target: Node } | null = null;
  let sourceReady=!sourceObservation;
  const layout = (report=true) => {const positions=painter.paint(annotations);if(report&&sourceReady)post({ kind: 'event', event: { type: 'mx:annotation-layout', nonce, positions, viewStateError: commentView.error } });};
  const actions = createHtmlSelectionActions({ win, capture: target => htmlSelection(win, target, config.revision, config.savedNodeIds), onAction: (action, selected) => post({ kind: 'event', event: { type: 'mx:selection-action', nonce, action, selection: selected } }) });
  const readiness=sourceObservation?startSourceAnnotationReadiness(win,()=>{sourceReady=true;if(annotations.pins.length)layout();}):null;
  const ownsOverlay=(node:Node)=>painter.ownsOverlay(node)||presence.ownsOverlay(node)||actions.ownsOverlay(node);
  const observation=observeHtmlDom(win,ownsOverlay,()=>{if(annotations.pins.length)layout(!sourceObservation);presence.paint();},painter.ownsMutation);
  const annotationObservation=sourceObservation?observeSourceAnnotations(win,{root:win.document.body,ownsOverlay,repaint:()=>{if(annotations.pins.length)layout();}}):null;
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
  const attachedRelay=relay;
  if(connectedBefore)void Promise.resolve().then(()=>{if(relay===attachedRelay)for(const listener of invalidationListeners)try{listener([...config.backends]);}catch{/* Independent subscriptions. */}});
  connectedBefore=true;
  const selection = () => {
    if (pick === 'area' || !win.getSelection()?.toString().trim()) return;
    post({ kind: 'event', event: { type: 'mx:selection', nonce, selection: htmlSelection(win, undefined, config.revision, config.savedNodeIds) } });
  };
  const resize = () => layout();
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
  win.addEventListener('resize', resize);
  post({ kind: 'ready', nonce });
  return {
    receive(payload) {
      if(payload.kind==='upload-context'){updateUploadContext(payload.context);return;}
      if (payload.kind === 'restored') post({ kind: 'restored', call: payload.call, ok: true });
      if (uploadSession.receive(payload))return;
      if (payload.kind === 'fetch-result') {
        const current = pending.get(payload.call);
        if (!current) return;
        pending.delete(payload.call);
        if ('error' in payload) current.reject(new Error('Remote request outcome unknown'));
        else try { current.resolve(JSON.parse(payload.body)); } catch { current.reject(new Error('Invalid remote reply; outcome unknown')); }
      }
      if (payload.kind === 'send') {
        applyHtmlReaderAppearance(win.document, payload.command);
        const command = payload.command as Partial<HtmlAnnotationPaint> & HtmlCommentViewCommand & { type?: string; annotate?: boolean; canComment?: boolean; pick?: typeof pick; path?: string | null; reveal?: boolean; datasets?: string[] };
        if (command?.type === 'mx:presence') presence.receive(payload.command as PresencePaint);
        // A new published version (solid/document/follow-html-version): drawn in place when safe, else the parent reloads.
        if (command?.type === HTML_VERSION_MESSAGE) { const version = Number((payload.command as { version?: unknown }).version); if (Number.isInteger(version)) void loadLiveMorph().then((morph) => morph.applyHtmlVersion(win, config, version)).then((applied) => { config.revision = applied.revision; config.savedNodeIds = applied.savedNodeIds; if (annotations.pins.length) layout(); presence.paint(); post({ kind: 'event', event: { type: HTML_VERSION_APPLIED, nonce, revision: applied.revision } }); }, (error: unknown) => post({ kind: 'event', event: { type: HTML_VERSION_REFUSED, nonce, reason: String(error instanceof Error ? error.message : error).slice(0, 300) } })); }
        if (command?.type === 'mx:data' && Array.isArray(command.datasets)) { const ids = new Set(command.datasets); const names = config.backends.filter((name) => ids.has(name) || ids.has(config.bindings?.[name] ?? '')); if (names.length) for (const listener of invalidationListeners) try { listener(names,"data"); } catch { /* One subscriber cannot stop the others. */ } }
        if (command?.type === 'mx:selection-actions') canAnnotate = command.annotate === true;
        if (command?.type === 'mx:annotations') { annotations = { pins: command.pins ?? [], mode: command.mode ?? 'off', openId: command.openId ?? null, hoverId: command.hoverId ?? null }; canAnnotate = command.canComment ?? canAnnotate; pick = command.pick ?? null; win.document.documentElement.style.cursor = pick ? 'crosshair' : cursor; }
        if (command?.type === 'mx:select') { const matches = [...win.document.querySelectorAll('[data-af-id]')].filter((node) => node.getAttribute('data-af-id') === command.path); const target = matches.length===1 ? matches[0] : null; const selected = target ? htmlSelection(win, target, config.revision, config.savedNodeIds) : null; if (command.reveal) target?.scrollIntoView?.(); post({ kind: 'event', event: { type: 'mx:selection', nonce, selection: selected } }); }
        if (command?.type === 'mx:annotations' || command?.type === 'mx:selection-actions') actions.update(canAnnotate && !pick);
        if (command?.type === 'mx:annotations') void commentView.receive(command).then(changed => { const pin = annotations.pins.find(pin => pin.id === annotations.openId); if(changed && pin) revealHtmlAnnotation(win.document,pin); layout(); });
      }
    },
    dispose() {
      stopLinks();
      uploadSession.dispose();if(uploads===uploadSession){uploads=undefined;uploadContext.update({state:'unavailable',scope:nonce+':closed'});}
      relay = null;
      observation.dispose();
      annotationObservation?.dispose();
      readiness?.dispose();
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
      win.removeEventListener('resize', resize);
    },
  };
}

/** Downloads attach only a credential-free document transport; no source upload occurs. */
let portableStartup:Promise<()=>void>|undefined;
export function startPortableDocument(win:Window=window,publishOrigin?:string):Promise<()=>void> {
 if(portableStartup)return portableStartup;
 portableStartup=(async()=>{
  const name='@afbin/portable';const {startPortableSession}=await import(name) as typeof import('./portable-session');
  const dispose=startPortableSession({win,publishOrigin,adoptIdentity(identity,source){config.pageId=identity.artifactId;config.revision=identity.baseRevision;const parsed=new DOMParser().parseFromString(source,'text/html'),declarations=sourceNamespaces(parsed);config.backends=declarations.names;config.bindings=declarations.bindings;},attach:post=>startFrameBridge({win,post}),online(value,request,pending){
   const available=portableReadiness.update(value,request as RemotePort['execute']|undefined,pending);
   if(available&&config.backends.length)for(const listener of invalidationListeners)try{listener([...config.backends]);}catch{/* Independent author subscribers. */}
  }});
  return ()=>{portableReadiness.dispose();dispose();};
 })().catch(error=>{portableReadiness.update(false);win.document.documentElement.setAttribute('data-af-connection','unavailable');throw error;});
 return portableStartup;
}
