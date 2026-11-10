/**
 * A NATIVE HTML PAGE BROUGHT TO ITS NEW VERSION IN PLACE (D9), inside the document frame.
 *
 * Runs the compiled-story engine's DOM morph (lib/islands/morph/dom) keyed by `data-af-id`: unchanged nodes stay the
 * same nodes, so the reader's scroll, focus, form values and anything the page's own scripts drew (a running chart)
 * survive. It draws a version in place only when that is safe, and refuses — the parent then reloads, as before —
 * otherwise:
 *
 *  · SCRIPTS: the new version's script fingerprint (lib/html-autofix scriptFingerprint, served in the runtime JSON)
 *    must equal the running page's. Scripts never re-run, so equal code is the precondition.
 *  · INERT EDITS ONLY: no added, changed or removed interactive element (controls, links, forms, contenteditable,
 *    disclosure, custom elements, `data-af` controls, inline `on*` handlers) and no added or changed element whose
 *    id, class or data-af-id appears in the page's scripts (they may have been queried and wired at load).
 *  · EDITABLE REGIONS (`data-af-editable` rich|text) are text, not controls: the region's element and the plain content
 *    a region holds (paragraphs, headings, lists, quotes, code, rules, links and inline marks, with no attribute but
 *    their id and a link's href) are drawn in place. While a person EDITS a region (lib/html-runtime/frame-regions),
 *    its element belongs to the editor: a version leaves it as it is (the editor gets the text through its session),
 *    so a saved version neither redraws nor rebuilds under someone typing; only the revision and saved ids advance.
 *
 * A version it cannot draw in place is REBUILT by the frame itself (applyHtmlVersion `rebuild`): a fresh document from the
 * new version, so no old listener, timer or chart keeps running, with the reader's place carried over (./reading-place)
 * and viewer state already in browser storage. Only when no valid new version could be read does the parent reload.
 *
 * What changed is decided SOURCE AGAINST SOURCE: the HTML this document loaded (captured by the core before the page's
 * deferred scripts ran) against the new served HTML, so script-made DOM never reads as an edit. Elements the source
 * does not name (platform overlays, script-made nodes) are left where they are.
 */
import {heldNodes,morphChildren,type MorphContext} from './morph/dom';
import {LIVE_VERSION_HEADER,LOADED_SOURCE_KEY} from './live-morph-contract';
import {captureReadingPlace} from './reading-place';
/** server/pages-host's one-time ticket parameter (lib/http/pages-origin PAGES_TICKET_PARAM), never part of the document's address. */
const PAGES_TICKET='_pt';

/** The parent reloads instead. */
export class VersionRefused extends Error {}
const refuse=(why:string)=>new VersionRefused(why);

/** Where the core keeps the HTML this document loaded (lib/html-runtime/build.server, captured at readyState interactive). */
export const LOADED_SOURCE=Symbol.for(LOADED_SOURCE_KEY);

interface Runtime {revision?:string;live?:number;savedNodeIds?:string[];scriptFingerprint?:string;appearance?:{designSystem?:string};files?:Record<string,string>}
/** The files a version published (./fn-fetch), each address without its version pin: what the scripts read. */
const filesOf=(runtime:Runtime)=>JSON.stringify(Object.entries(runtime.files??{}).map(([name,address])=>[name,address.replace(/&version=\d+$/,'')]).sort());
const runtimeOf=(doc:Document):Runtime=>{try{return JSON.parse(doc.querySelector('script[data-af="runtime"]')?.textContent??'{}') as Runtime;}catch{return {};}};
const ID='data-af-id';
const INTERACTIVE=new Set(['button','input','select','textarea','form','a','details','summary','option','optgroup','datalist','dialog','label','output','iframe','object','embed','video','audio','canvas']);
const EDITABLE='data-af-editable';
const REGION_KINDS=new Set(['rich','text','rich-native-v1']);
/** What a region's saved HTML is made of (lib/live-regions html.ts writes only these). */
const REGION_CONTENT=new Set(['p','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','hr','a','strong','b','em','i','br']);
const regionOf=(element:Element)=>{const region=element.closest(`[${EDITABLE}]`);return region&&REGION_KINDS.has(region.getAttribute(EDITABLE)??'')?region:null;};
/** Plain region content: a content tag inside a region, carrying only its id (and a link its href). */
const regionContent=(element:Element)=>{const region=element.parentElement&&regionOf(element.parentElement);return !!region&&REGION_CONTENT.has(element.localName)&&[...element.attributes].every(attr=>attr.name===ID||element.localName==='a'&&attr.name==='href'||region.getAttribute(EDITABLE)==='rich-native-v1'&&((element.localName==='ol'&&attr.name==='start')||(['ul','li'].includes(element.localName)&&attr.name==='data-type')||(element.localName==='li'&&attr.name==='data-checked')));};

/** An element whose behaviour a script, the browser or a component wires: never redrawn under it. */
export function interactive(element:Element):boolean{
 if(regionContent(element))return false;
 if(INTERACTIVE.has(element.localName)||element.localName.includes('-')||element.hasAttribute('contenteditable'))return true;
 for(const attr of element.attributes){const name=attr.name.toLowerCase();if(name.startsWith('on')||name==='data-af'||name.startsWith('data-af-')&&name!==ID&&!(name===EDITABLE&&REGION_KINDS.has(attr.value)))return true;}
 return false;
}
const byId=(doc:Document,ids:ReadonlySet<string>)=>{const map=new Map<string,Element>();for(const element of doc.querySelectorAll(`[${ID}]`)){const id=element.getAttribute(ID)!;if(ids.has(id)&&!map.has(id))map.set(id,element);}return map;};
/**
 * Served asset URLs are pinned to the version that serves them (`version=N`, lib/html-publication-bundle pinPublicationAssetUrls):
 * the same immutable file under another version's address is not an edit, and the running page keeps the address it has.
 */
const URL_ATTRIBUTES=new Set(['src','href','poster','srcset','data']);
const unpinned=(name:string,value:string)=>URL_ATTRIBUTES.has(name)?value.replace(/([?&])version=\d+(&|(?=#)|$)/g,(_,lead:string,tail:string)=>tail?lead:''):value;
function unpin(doc:Document):Document{for(const element of doc.querySelectorAll('[src],[href],[poster],[srcset],[data]'))for(const attr of [...element.attributes])if(URL_ATTRIBUTES.has(attr.name)){const value=unpinned(attr.name,attr.value);if(value!==attr.value)element.setAttribute(attr.name,value);}return doc;}
const attrs=(element:Element)=>[...element.attributes].map(attr=>attr.name+'='+attr.value).sort().join('\u0000');
/** An element's own content: its attributes and the shape of its children (text values, child identities), not their insides. */
const own=(element:Element)=>attrs(element)+'\u0001'+[...element.childNodes].map(node=>node.nodeType===3?'#'+node.nodeValue:node.nodeType===1?'@'+((node as Element).getAttribute(ID)??(node as Element).localName):'').join('\u0002');
const mentioned=(token:string,scripts:string)=>{const escaped=token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`(^|[^\\w-])${escaped}([^\\w-]|$)`).test(scripts);};

export interface VersionPlan {
 /** IDs whose source subtree is identical in both versions: their live nodes are never touched. */
 stable:Set<string>;
 oldIds:Set<string>;newIds:Set<string>;
 before:Map<string,Element>;after:Map<string,Element>;
}
/** What changed between the loaded and the new source, or why it must reload. `scripts` is the page's script text, null when some of it could not be read. `editing`: the ids of regions an editor holds, whose changes are the editor's. */
export function planVersion(loaded:Document,next:Document,scripts:string|null,oldIds?:readonly string[],editing?:ReadonlySet<string>):VersionPlan{
 const current=runtimeOf(loaded),incoming=runtimeOf(next);
 if(!incoming.scriptFingerprint||incoming.scriptFingerprint!==current.scriptFingerprint)throw refuse('the new version runs different scripts');
 // Scripts already ran over the files the loaded version published; new files need them to run again.
 if(filesOf(incoming)!==filesOf(current))throw refuse('the new version publishes different files');
 const oldSet=new Set(oldIds??current.savedNodeIds??[]),newSet=new Set(incoming.savedNodeIds??[]);
 const before=byId(loaded,oldSet),after=byId(next,newSet);
 const stable=new Set<string>(),touched:Element[]=[],removed:Element[]=[];
 for(const [id,element] of after){
  const previous=before.get(id);
  if(!previous){touched.push(element);continue;}
  if(previous.isEqualNode(element)){stable.add(id);continue;}
  if(own(previous)!==own(element))touched.push(element);
 }
 for(const [id,element] of before)if(!after.has(id))removed.push(element);
 const held=(element:Element)=>{const region=editing?.size?regionOf(element):null;return !!region&&editing!.has(region.getAttribute(ID)??'');};
 if(editing?.size)for(const list of [touched,removed])for(let i=list.length-1;i>=0;i--)if(held(list[i]!))list.splice(i,1);
 for(const element of [...touched,...removed]){
  for(let at:Element|null=element;at&&at.localName!=='body'&&at.localName!=='head';at=at.parentElement)
   if(interactive(at))throw refuse(`an interactive element changed (<${at.localName}>)`);
  // A region's inline marks carry no id: they change with the block that holds them.
  if(regionOf(element))for(const inner of element.querySelectorAll(`*:not([${ID}])`))if(interactive(inner))throw refuse(`an interactive element changed (<${inner.localName}>)`);
 }
 for(const element of touched){
  const names=[element.id,...element.classList].filter(Boolean);
  if(scripts===null){if(names.length)throw refuse('a changed element is named by an id or class and the page scripts could not be read');continue;}
  const named=[...names,element.getAttribute(ID)??''].filter(Boolean).find(token=>mentioned(token,scripts));
  if(named)throw refuse(`a changed element is named in the page scripts ("${named}")`);
 }
 return {stable,oldIds:oldSet,newIds:newSet,before,after};
}

/** `live` takes the attribute changes `before`→`after` made in the source; attributes a script set are kept. */
/** <html> attributes the platform owns (lib/html-page/design-system): the core sets them, the source never decides them. */
const PLATFORM_ROOT=new Set(['data-af-dark','data-af-design-system']);
function applyAttributes(live:Element,before:Element|undefined,after:Element):void{
 // A script that ran is not changed by its attributes; equal fingerprints say its code did not change.
 if(live.localName==='script')return;
 const root=live.localName==='html';
 for(const attr of after.attributes){if(root&&PLATFORM_ROOT.has(attr.name))continue;const was=before?.getAttribute(attr.name);if((was===null||was===undefined||was!==unpinned(attr.name,attr.value))&&live.getAttribute(attr.name)!==attr.value)live.setAttribute(attr.name,attr.value);}
 if(before)for(const attr of before.attributes)if(!after.hasAttribute(attr.name)&&!(root&&PLATFORM_ROOT.has(attr.name)))live.removeAttribute(attr.name);
}
const SHEET='style,link';
const isSheet=(element:Element)=>element.localName==='style'||element.localName==='link'&&(element.getAttribute('rel')??'').split(/\s+/).includes('stylesheet');
/** The head's stylesheets by identity: same text in place, a moved link swapped once the new one has loaded, new ones in order, removed ones gone. */
function syncHead(doc:Document,plan:VersionPlan,next:Document):void{
 const live=new Map<string,Element>();for(const element of doc.head.querySelectorAll(SHEET)){const id=element.getAttribute(ID);if(id&&isSheet(element))live.set(id,element);}
 let anchor:Element|null=null;
 for(const sheet of next.head.querySelectorAll(SHEET)){
  const id=sheet.getAttribute(ID);if(!id||!isSheet(sheet))continue;
  const here=live.get(id);
  if(here){
   anchor=here;if(plan.stable.has(id))continue;
   if(here.localName==='style'){if(here.textContent!==sheet.textContent)here.textContent=sheet.textContent;applyAttributes(here,plan.before.get(id),sheet);continue;}
   if(unpinned('href',here.getAttribute('href')??'')===unpinned('href',sheet.getAttribute('href')??'')){applyAttributes(here,plan.before.get(id),sheet);continue;}
   const fresh=doc.importNode(sheet,true);here.after(fresh);anchor=fresh;
   const retire=()=>here.remove();fresh.addEventListener('load',retire,{once:true});fresh.addEventListener('error',retire,{once:true});
   continue;
  }
  const fresh=doc.importNode(sheet,true);
  if(anchor)anchor.after(fresh);else doc.head.append(fresh);
  anchor=fresh;
 }
 for(const [id,element] of live)if(plan.oldIds.has(id)&&!plan.newIds.has(id))element.remove();
 const title=next.querySelector('head > title')?.textContent;if(title!==undefined&&title!==null&&doc.title!==title)doc.title=title;
}

/** A held editor's stand-in (lib/html-runtime/morph/dom EDIT_REGION_ATTR): the morph keeps the live element there as it is. */
const EDIT_REGION_ATTR='data-mx-edit-region';
/**
 * Draw `next` (served HTML) over the running document that loaded `loaded`. Throws VersionRefused, or anything the DOM
 * throws. `editing`: region id → the element an editor holds (lib/html-runtime/frame-regions), kept as it is.
 */
export function morphHtmlVersion(doc:Document,loaded:string,next:string,scripts:string|null,oldIds?:readonly string[],editing?:ReadonlyMap<string,Element>):{revision:string;savedNodeIds:string[]}{
 // Compared unpinned; drawn from the served bytes as they are.
 const parser=new DOMParser(),before=unpin(parser.parseFromString(loaded,'text/html')),after=parser.parseFromString(next,'text/html');
 const plan=planVersion(before,unpin(parser.parseFromString(next,'text/html')),scripts,oldIds,editing&&new Set(editing.keys()));
 const editRegions=new Map<string,Element>();
 if(editing)for(const [id,live] of editing){const standIn=after.querySelectorAll(`[${EDITABLE}]`);for(const element of standIn)if(element.getAttribute(ID)===id&&live.isConnected){element.setAttribute(EDIT_REGION_ATTR,id);editRegions.set(id,live);}}
 const source=(element:Element)=>{const id=element.getAttribute(ID);return id&&(plan.oldIds.has(id)||plan.newIds.has(id))?id:'';};
 // Script-made and platform nodes stay where they are: never matched, moved or removed. A region's content is source,
 // with or without ids (its inline marks carry none), so it is matched and redrawn like the rest.
 const kept=new Set<Node>([...doc.body.querySelectorAll('*')].filter(element=>!plan.oldIds.has(element.getAttribute(ID)??'')&&!regionContent(element)));
 const ctx:MorphContext={keep:new Map(),oldUnits:new Map(),used:new Set(),kept,held:heldNodes(doc.body),stableElementIds:plan.stable,idOf:source,editRegions,
  syncAttributes:(live,incoming)=>{const id=source(incoming);applyAttributes(live,id?plan.before.get(id):undefined,incoming);}};
 syncHead(doc,plan,after);
 applyAttributes(doc.documentElement,before.documentElement,after.documentElement);
 applyAttributes(doc.body,before.body,after.body);
 morphChildren(doc.body,after.body,ctx);
 const runtime=runtimeOf(after);
 // The new version may name another design system; the viewer's light/dark stays as it is.
 const system=runtime.appearance?.designSystem;if(typeof system==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(system)&&doc.documentElement.getAttribute('data-af-design-system')!==system)doc.documentElement.setAttribute('data-af-design-system',system);
 return {revision:String(runtime.revision??''),savedNodeIds:[...plan.newIds]};
}

/** The page's own script text (inline, and each authored script file it loaded), or null when a file could not be read. */
export async function pageScripts(doc:Document,fetchFn:typeof fetch):Promise<string|null>{
 const parts:string[]=[];let complete=true;
 const sources:string[]=[];
 for(const script of doc.querySelectorAll('script')){
  const type=(script.getAttribute('type')??'').trim().toLowerCase();
  if(script.hasAttribute('data-af')||!['','module','text/javascript','application/javascript'].includes(type))continue;
  const src=script.getAttribute('src');
  if(src){if(!/\/af\/v1\//.test(src))sources.push(new URL(src,doc.baseURI).href);}else parts.push(script.textContent??'');
 }
 await Promise.all(sources.map(async url=>{try{const response=await fetchFn(url,{credentials:'same-origin'});if(!response.ok)throw Error();parts.push(await response.text());}catch{complete=false;}}));
 return complete?parts.join('\n'):null;
}

export interface VersionApplied {
 revision:string;savedNodeIds:string[];
 /** The drawn page's live revision within `revision` (lib/artifacts current-page), 0 when it holds none. */
 live?:number;
 /** Set when the version could not be drawn in place: the frame navigates here (its own clean address) to rebuild from it. */
 rebuild?:string;
 /** With `rebuild`: why it could not be drawn in place (the parent reports it). */
 reason?:string;
}
/**
 * Fetch the newest served version the way this frame got its document (its own address, its own session) and draw it in
 * place, or, when that is refused or fails, keep the reader's place and say where to rebuild from. Rejects (VersionRefused
 * or any error) only when no valid new version was read: then the parent reloads.
 *
 * `live`: the page's live revision announced with `version` (its regions' unsaved text changed, no new version). The
 * served page is the current page, so it must be at least (version, live): a newer version, or this one at least as live.
 */
export async function applyHtmlVersion(win:Window,config:{revision:string;live?:number;savedNodeIds?:readonly string[];pageId?:string},version:number,fetchFn:typeof fetch=win.fetch.bind(win),editing?:()=>ReadonlyMap<string,Element>,live=0):Promise<VersionApplied>{
 const holder=win as unknown as Record<symbol,unknown>,loaded=holder[LOADED_SOURCE];
 if(typeof loaded!=='string')throw refuse('this document kept no copy of its source');
 // Live text this document already holds (it was served at, or has drawn, this version at least this live): nothing to fetch.
 if(live>0&&Number(config.revision)===version&&(config.live??0)>=live)return {revision:config.revision,live:config.live??0,savedNodeIds:[...(config.savedNodeIds??[])]};
 // Without the ticket (spent) or the fragment (an `#af-state=` link would replace the viewer's own state on a rebuild).
 const address=new URL(win.location.href);address.searchParams.delete(PAGES_TICKET);address.hash='';
 // Marked so the read is not counted as another view of the page (app/a/[id]/raw).
 const response=await fetchFn(address.href,{credentials:'same-origin',cache:'no-store',headers:{[LIVE_VERSION_HEADER]:'1'}});
 if(!response.ok)throw refuse(`the new version answered ${response.status}`);
 const next=await response.text();
 const served=runtimeOf(new DOMParser().parseFromString(next,'text/html'));
 const revision=Number(served.revision),servedLive=Number(served.live??0);
 if(!Number.isInteger(revision)||revision<version)throw refuse('the served version is not the published one');
 if(revision===version&&!(servedLive>=live))throw refuse('the served page is older than its announced live text');
 let applied:VersionApplied;
 try{const scripts=await pageScripts(win.document,fetchFn);applied=morphHtmlVersion(win.document,loaded,next,scripts,config.savedNodeIds,editing?.());}
 catch(cause){
  // Different scripts, an edit that is not inert, or a morph the DOM refused half way: a fresh document is always right.
  captureReadingPlace(win,config.pageId??'');
  return {revision:String(revision),live:servedLive,savedNodeIds:[],rebuild:address.href,reason:String(cause instanceof Error?cause.message:cause).slice(0,300)};
 }
 holder[LOADED_SOURCE]=next;
 return {...applied,live:servedLive};
}
