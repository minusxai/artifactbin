import {commentViewDeclaration,createHtmlCommentView} from './comment-view';
import {installHtmlCommentView} from '../html-bridge/comment-view-session';
import {createClient,gql,readStateFragment} from './apollo/client';
import {createViewerState} from './viewer-state';
import type {StoreReceipt} from './apollo/apollo-contracts';
import {config,remote} from './browser-reader';
export {startFrameBridge,onResolverChange,remoteReadOnly,uploadFile,watchUploadContext,bindFileUpload} from './browser-reader';
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
