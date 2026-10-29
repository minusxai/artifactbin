import {createHtmlCommentView} from './comment-view';
import {installHtmlCommentView} from '../html-bridge/comment-view-session';
import {createClient,gql,readStateFragment} from './apollo/client';
import {createViewerState} from './viewer-state';
import type {StoreReceipt} from './apollo/apollo-contracts';
import {config,remote} from './browser-reader';
export {startFrameBridge,onBackendChange,remoteReadOnly,uploadFile,watchUploadContext,bindFileUpload} from './browser-reader';
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
export const client=createClient({backends:()=>config.backends??[],state,remote});

// Authors explicitly choose UI fields suitable for sharing beside a comment.
const viewBlock=document.querySelector('[data-af="state"][data-af-comment-fields][data-af-comment-version]');
if(viewBlock) {
 try {
  const fields:unknown=JSON.parse(viewBlock.getAttribute('data-af-comment-fields')!);
  if(!Array.isArray(fields)||fields.some(key=>typeof key!=='string'))throw new Error('Invalid fields');
  installHtmlCommentView(document,createHtmlCommentView({state,backends:config.backends??[],declaration:{version:viewBlock.getAttribute('data-af-comment-version')!,fields}}));
 }catch { installHtmlCommentView(document,{capture(){throw new Error('Invalid comment view declaration');},async restore(){throw new Error('Invalid comment view declaration');}}); }
}
else installHtmlCommentView(document,undefined);

/** Read only for an explicit local Save action; this private document is never uploaded automatically. */
export const readViewerDocument=()=>state.read();

export type {FileUploadOptions} from './upload-contract';

export type {UploadContext} from '@artifactbin/contracts';
export type {PlatformUploadControl,FileUploadBinding} from './upload-contract';

// probe: pull request lane type check timing
