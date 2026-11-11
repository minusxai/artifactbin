import {followHtmlVersion,type VersionFrame} from '@/lib/html-reader/follow-version';

/**
 * The document page's publication handler (solid/pages/Document, loaded only when a version arrives so the app shell stays
 * within its size budget). Versions, and live text within one (`live`), are followed one at a time in (version, live)
 * order; a page that reloads follows nothing after it.
 *
 * LIVE TEXT IS NEVER WORTH A RELOAD: live text within the version this page already shows (`drawn`) that the frame
 * could not draw (its own re-fetch failed, as a cross-site frame's does without its cookie over plain http, or it
 * stayed silent) is skipped, and the page stays as it is until the next ping or version: a reload per keystroke burst
 * would take the editor's caret and the reader's place every few hundred milliseconds.
 */
let following:Promise<void>=Promise.resolve(),newest={version:0,live:0};
const after=(a:{version:number;live:number},b:{version:number;live:number})=>a.version>b.version||a.version===b.version&&a.live>b.live;
export function followPublication(options:{
 version:number;editId?:string;live?:number;
 /** The version this page shows now: an announcement within it is live text only. */
 drawn?:number;
 frame:VersionFrame|null;
 /** The drawn version's tree when the frame holds one (undefined when it holds none, null when it could not be read). */
 show:(head:{version:number;editId:string})=>void;
 reload:()=>void;
}):Promise<void>{
 // One at a time; one overtaken while it waited is skipped (the newer one draws the current page anyway).
 const mine={version:options.version,live:options.live??0};
 if(after(mine,newest))newest=mine;
 const liveOnly=options.drawn!==undefined&&options.version<=options.drawn;
 return following=following.then(()=>after(newest,mine)?undefined:followHtmlVersion({version:options.version,live:mine.live,frame:options.frame,reload:liveOnly?()=>{}:options.reload,
  // The frame draws the newest version it is served: this one, or one published since (then announced next).
  refresh:async(drawn,revision)=>{
   const shown=Number(revision);
   if(!Number.isInteger(shown)||shown<drawn)return false;
   options.show({version:shown,editId:options.editId??''});
   return true;
  }}).then(outcome=>outcome!=='reloaded'||liveOnly?undefined:new Promise<never>(()=>{/* the page is reloading: nothing follows it */})));
}
