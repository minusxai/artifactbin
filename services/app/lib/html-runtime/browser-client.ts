import {commentViewDeclaration,createHtmlCommentView} from './comment-view';
import {installHtmlCommentView} from '../html-bridge/comment-view-session';
import {createClient,gql,readStateFragment} from './apollo/client';
import {createViewerState} from './viewer-state';
import type {StoreReceipt} from './apollo/apollo-contracts';
import {config,remote,onResolverChange} from './browser-reader';
import {createSql,SqlError} from './apollo/sql';
import {RemoteUnreachable} from './apollo/apollo-contracts';
export {startFrameBridge,onResolverChange,remoteReadOnly,uploadFile,watchUploadContext,bindFileUpload} from './browser-reader';
// Names live pages still call (onResolverChange's old name); isolated with their deletion rule in legacy-page-names.
export * from './legacy-page-names';
export {gql};
// A raw authored file may place its state block after the blocking core script.
// Read defaults only when the author first imports the client, after that block is parsed.
let initial=config.initialState;
if(!initial){try{initial=JSON.parse(document.querySelector('[data-af="state"]')?.textContent||'{}')}catch{initial={}}}
const key = `af:viewer:${config.pageId}`;
const carried = readStateFragment(location.hash);
const state = createViewerState({
  initial: carried.state ?? initial ?? {}, replaceInitial: !!carried.state,
  storage: { read: () => localStorage.getItem(key), write: (json) => localStorage.setItem(key, json) },
  observe(listener) { const changed = (event: StorageEvent) => { if (event.key === key) listener(); }; addEventListener('storage', changed); return () => removeEventListener('storage', changed); },
  ...(navigator.locks ? { lock: (work: () => Promise<StoreReceipt>) => Promise.resolve(navigator.locks.request(key, work)) } : {}),
});
/** One statement over the page's dataset links as the reader (./apollo/sql): `${…}` values are always bound parameters. */
/**
 * `sql` (./apollo/sql) reaches the page SQL door through the reader's ONE request relay, the one GraphQL uses
 * (`remote.execute`, marked `operation: 'sql'`): the frame-bridge parent routes it to /api/artifacts/<page>/sql with the
 * trusted revision bound (lib/html-reader/frame-bridge parent `relayedSql`). The reader carries no SQL code at all: it
 * sits at its 20 KiB gzip budget (html-runtime build.test). No app frame relays in a downloaded copy, a local preview or
 * an owner host's own reads (the reader builds those transports from this same config), so those refuse at once.
 */
export const sql=createSql({
  run:(request)=>config.offline||config.localPreview||(config.domainReads&&window.parent===window)?Promise.reject(new SqlError('unavailable','sql runs in a page the app frames'))
   :remote.execute({...request,operation:'sql'} as never).then((reply)=>reply as never,(error:unknown)=>{throw error instanceof RemoteUnreachable?new SqlError('unavailable','sql runs in a page the app frames'):error;}),
  subscribe:(listener)=>{const subscription=onResolverChange((names,reason)=>listener(reason==='authority'?undefined:names));return()=>subscription.unsubscribe();},
});
export {SqlError} from './apollo/sql';
export const client=createClient({backends:()=>config.backends??[],datasets:()=>config.datasets??[],state,remote});

// Saved comment views: the authored state block's fields (lib/html-runtime/comment-view). An invalid list saves nothing.
const viewBlock=document.querySelector('[data-af="state"]');
try {
 const declaration=viewBlock ? commentViewDeclaration({initial:initial??{},attribute:name=>viewBlock.getAttribute(name)},config.backends??[]) : undefined;
 installHtmlCommentView(document,declaration&&createHtmlCommentView({state,backends:config.backends??[],declaration}));
}catch { installHtmlCommentView(document,{capture(){throw new Error('Invalid comment view declaration');},async restore(){throw new Error('Invalid comment view declaration');}}); }

/** Read only for an explicit local Save action; this private document is never uploaded automatically. */
export const readViewerDocument=()=>state.read();

export type {FileUploadOptions} from './upload-contract';

export type {UploadContext} from '@artifactbin/contracts';
export type {PlatformUploadControl,FileUploadBinding} from './upload-contract';
