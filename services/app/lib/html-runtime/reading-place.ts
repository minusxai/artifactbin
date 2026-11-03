/**
 * THE READER'S PLACE, CARRIED ACROSS A SOFT RELOAD (D9) of a framed native HTML page.
 *
 * When a new version cannot be drawn in place (./live-morph refuses: its scripts changed, or the edit is not inert), the
 * frame rebuilds its document from the new version instead of the parent reloading the whole app page. Before it
 * navigates, `captureReadingPlace` keeps where the reader was — the source element (`data-af-id`) at the top of the
 * viewport and its offset, the raw scroll as a fallback, the focused element — in this origin's sessionStorage. The new
 * document's core (build.server, framed pages only) calls `restoreReadingPlace`: the record is read once and deleted,
 * applied when the body is parsed and again as the page grows (charts lay out after their data arrives), until the
 * reader scrolls, types or points, or the page has settled. Viewer state needs nothing here: it lives in localStorage.
 *
 * Shipped inline in every framed page's core: keep it small.
 */
const ID='data-af-id';
/** A record older than this belongs to some earlier rebuild, not to the document loading now. */
const FRESH_MS=10_000;
/** After `load`, how long the page may keep growing under the reader before the place is left alone. */
const SETTLE_MS=3000;
const keyOf=(pageId:string)=>`afbin:reading-place:${pageId}`;

export interface ReadingPlace {at:number;scrollX:number;scrollY:number;anchor:{id:string;offset:number}|null;focus:string|null}

const sourceElements=(doc:Document)=>doc.body?[...doc.body.querySelectorAll<HTMLElement>(`[${ID}]`)]:[];
const find=(doc:Document,id:string)=>sourceElements(doc).find(element=>element.getAttribute(ID)===id);

/** Where the reader is: the deepest source element crossing the viewport's top edge, else the first one below it. */
export function readingPlace(win:Window,now=Date.now()):ReadingPlace{
 let anchor:ReadingPlace['anchor']=null;
 if(win.scrollY>0){
  let best:{id:string;top:number}|null=null;
  for(const element of sourceElements(win.document)){
   const rect=element.getBoundingClientRect();
   if(rect.height<=0||rect.bottom<=0||rect.top>=win.innerHeight)continue;
   // Crossing the top: the one starting lowest (the innermost) is the most precise. Otherwise the nearest below it.
   const better=!best||(rect.top<=0?best.top>0||rect.top>=best.top:best.top>0&&rect.top<best.top);
   if(better)best={id:element.getAttribute(ID)!,top:rect.top};
  }
  if(best)anchor={id:best.id,offset:best.top};
 }
 const focused=win.document.activeElement;
 const focus=focused&&focused!==win.document.body?focused.getAttribute(ID):null;
 return {at:now,scrollX:win.scrollX,scrollY:win.scrollY,anchor,focus};
}

/** Keep the reader's place for the document this frame loads next. Storage refused: the rebuild starts at the top. */
export function captureReadingPlace(win:Window,pageId:string,now=Date.now()):void{
 try{win.sessionStorage.setItem(keyOf(pageId),JSON.stringify(readingPlace(win,now)));}catch{/* the rebuild still happens */}
}

/** Put the reader back where the previous document of this page left them, once. Returns a disposer. */
export function restoreReadingPlace(win:Window,pageId:string,now=Date.now()):()=>void{
 let place:ReadingPlace|null=null;
 try{const raw=win.sessionStorage.getItem(keyOf(pageId));if(raw!==null){win.sessionStorage.removeItem(keyOf(pageId));place=JSON.parse(raw) as ReadingPlace;}}catch{/* nothing carried */}
 if(!place||typeof place.at!=='number'||now-place.at>FRESH_MS||now<place.at)return()=>{};
 const kept=place,doc=win.document;
 let stopped=false,observer:ResizeObserver|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 const apply=()=>{
  if(stopped)return;
  const element=kept.anchor&&find(doc,kept.anchor.id);
  const top=element?element.getBoundingClientRect().top+win.scrollY-kept.anchor!.offset:kept.scrollY;
  if(Math.abs(win.scrollY-top)>=1||Math.abs(win.scrollX-kept.scrollX)>=1)win.scrollTo(kept.scrollX,top);
 };
 const INPUT=['wheel','touchstart','keydown','pointerdown'] as const;
 const stop=()=>{if(stopped)return;stopped=true;observer?.disconnect();clearTimeout(timer);for(const type of INPUT)win.removeEventListener(type,stop,true);doc.removeEventListener('DOMContentLoaded',parsed);win.removeEventListener('load',loaded);};
 const parsed=()=>{
  if(stopped)return;
  apply();
  const focused=kept.focus&&find(doc,kept.focus);
  if(focused&&(doc.activeElement===doc.body||!doc.activeElement))try{focused.focus({preventScroll:true});}catch{/* not focusable */}
  if(typeof ResizeObserver==='function'){observer=new ResizeObserver(apply);observer.observe(doc.documentElement);if(doc.body)observer.observe(doc.body);}
 };
 const loaded=()=>{apply();timer=setTimeout(stop,SETTLE_MS);};
 // The reader's own move wins over the carried place.
 for(const type of INPUT)win.addEventListener(type,stop,{capture:true,passive:true});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',parsed,{once:true});else parsed();
 if(doc.readyState==='complete')loaded();else win.addEventListener('load',loaded,{once:true});
 return stop;
}
