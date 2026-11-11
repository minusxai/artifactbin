/** Following a new published version in an open frame: shared by the app's document page and the document host module (./host-shell). */
import {HTML_VERSION_APPLIED,HTML_VERSION_MESSAGE,HTML_VERSION_REBUILT,HTML_VERSION_REFUSED} from './contract';

/** How long the frame has to draw a new version in place (or start rebuilding from it) before the page reloads instead. */
const HTML_VERSION_TIMEOUT_MS=3000;

export interface VersionFrame {send(command:unknown):void;subscribe(listener:(event:unknown)=>void):()=>void}
export interface FollowHtmlVersionOptions {
 version:number;
 /** The live revision announced within `version` (its regions' unsaved text moved, lib/artifacts current-page); 0 when none. */
 live?:number;
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
 * when the edit is inert and its scripts are unchanged, or else rebuilds its own document from it, keeping the reader's
 * place ('rebuilt'; the bridge re-attaches to the new document as it opens). Either way this page then refreshes its own
 * trusted revision. A refusal (no valid version was read), an error, a mismatched refresh or a frame silent for
 * `timeoutMs` reloads the whole page. Resolves 'morphed', 'rebuilt' or 'reloaded'.
 */
type Outcome='morphed'|'rebuilt'|'reloaded';
export function followHtmlVersion(options:FollowHtmlVersionOptions):Promise<Outcome>{
 const {frame,version}=options;
 if(!frame){options.reload();return Promise.resolve('reloaded');}
 return new Promise(resolve=>{
  let settled=false;
  const finish=(outcome:Outcome)=>{if(settled)return;settled=true;clearTimeout(timer);stop();if(outcome==='reloaded')options.reload();resolve(outcome);};
  const stop=frame.subscribe(event=>{
   const data=event as {type?:unknown;revision?:unknown}|null;
   if(data?.type===HTML_VERSION_REFUSED){finish('reloaded');return;}
   if(data?.type!==HTML_VERSION_APPLIED&&data?.type!==HTML_VERSION_REBUILT)return;
   stop();
   const revision=String(data.revision??''),drawn:Outcome=data.type===HTML_VERSION_REBUILT?'rebuilt':'morphed';
   // A rebuild costs the reader's live state (an editor's frame reopens it): say why, so it can be found and fixed.
   if(drawn==='rebuilt'&&typeof (data as {reason?:unknown}).reason==='string')console.warn(`[artifactbin] version ${version} rebuilt the page: ${(data as {reason:string}).reason}`);
   void options.refresh(version,revision).then(ok=>finish(ok?drawn:'reloaded'),()=>finish('reloaded'));
  });
  const timer=setTimeout(()=>finish('reloaded'),options.timeoutMs??HTML_VERSION_TIMEOUT_MS);
  try{frame.send({type:HTML_VERSION_MESSAGE,version,live:options.live??0});}catch{finish('reloaded');}
 });
}
