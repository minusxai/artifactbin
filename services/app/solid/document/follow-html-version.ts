import {HTML_VERSION_APPLIED,HTML_VERSION_MESSAGE,HTML_VERSION_REFUSED} from '@/lib/html-runtime/live-morph-contract';
import {STORY_DOCUMENT_MESSAGE} from '@/lib/story-runtime/contract';
import type {JsxNode} from '@/lib/jsx';

/** How long the frame has to draw a new version in place before the page reloads instead. */
const HTML_VERSION_TIMEOUT_MS=3000;

interface VersionFrame {send(command:unknown):void;subscribe(listener:(event:unknown)=>void):()=>void}
export interface FollowHtmlVersionOptions {
 version:number;
 /** The frame's controller (the bridge), or null when none is attached: then the page reloads. */
 frame:VersionFrame|null;
 /** The light refetch of this page's trusted state (revision, presence, nodes) for the drawn version; false on mismatch. */
 refresh:(version:number,revision:string)=>Promise<boolean>;
 /** Today's fallback: reload the server shell and its ticketed frame together. */
 reload:()=>void;
 timeoutMs?:number;
}

/**
 * A NEW PUBLISHED VERSION OF AN OPEN HTML PAGE (D9): the framed document draws it in place (lib/html-runtime/live-morph)
 * when the edit is inert and its scripts are unchanged; this page then refreshes its own trusted revision. A refusal, an
 * error, a mismatched refresh or a frame silent for `timeoutMs` reloads, exactly as every version did before.
 * Resolves 'morphed' or 'reloaded'.
 */
export function followHtmlVersion(options:FollowHtmlVersionOptions):Promise<'morphed'|'reloaded'>{
 const {frame,version}=options;
 if(!frame){options.reload();return Promise.resolve('reloaded');}
 return new Promise(resolve=>{
  let settled=false;
  const finish=(outcome:'morphed'|'reloaded')=>{if(settled)return;settled=true;clearTimeout(timer);stop();if(outcome==='reloaded')options.reload();resolve(outcome);};
  const stop=frame.subscribe(event=>{
   const data=event as {type?:unknown;revision?:unknown}|null;
   if(data?.type===HTML_VERSION_REFUSED){finish('reloaded');return;}
   if(data?.type!==HTML_VERSION_APPLIED)return;
   stop();
   const revision=String(data.revision??'');
   void options.refresh(version,revision).then(ok=>finish(ok?'morphed':'reloaded'),()=>finish('reloaded'));
  });
  const timer=setTimeout(()=>finish('reloaded'),options.timeoutMs??HTML_VERSION_TIMEOUT_MS);
  try{frame.send({type:HTML_VERSION_MESSAGE,version});}catch{finish('reloaded');}
 });
}

/**
 * The document page's publication handler (solid/pages/Document, loaded only when a version arrives so the app shell stays
 * within its size budget). Resolves once a version is drawn in place; a page that reloads never resolves it.
 */
export function followPublication(options:{
 version:number;editId?:string;
 frame:(VersionFrame&{update(command:{type:typeof STORY_DOCUMENT_MESSAGE;nodes:JsxNode[]}):void})|null;
 /** The drawn version's tree when the frame holds one (undefined when it holds none, null when it could not be read). */
 tree:()=>Promise<JsxNode[]|null|undefined>;
 show:(head:{version:number;editId:string})=>void;
 reload:()=>void;
}):Promise<void>{
 return followHtmlVersion({version:options.version,frame:options.frame,reload:options.reload,
  // The frame draws the newest version it is served: this one, or one published since (then announced next).
  refresh:async(drawn,revision)=>{
   const shown=Number(revision);
   if(!Number.isInteger(shown)||shown<drawn)return false;
   const nodes=await options.tree();
   if(nodes===null)return false;
   if(nodes)options.frame?.update({type:STORY_DOCUMENT_MESSAGE,nodes});
   options.show({version:shown,editId:options.editId??''});
   return true;
  }}).then(outcome=>outcome==='morphed'?undefined:new Promise<never>(()=>{/* the page is reloading */}));
}
