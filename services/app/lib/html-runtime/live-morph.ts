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
 *
 * What changed is decided SOURCE AGAINST SOURCE: the HTML this document loaded (captured by the core before the page's
 * deferred scripts ran) against the new served HTML, so script-made DOM never reads as an edit. Elements the source
 * does not name (platform overlays, script-made nodes) are left where they are.
 */
import {heldNodes,morphChildren,type MorphContext} from '../islands/morph/dom';
import {LIVE_VERSION_HEADER} from './live-morph-contract';
/** server/pages-host's one-time ticket parameter (lib/http/pages-origin PAGES_TICKET_PARAM), never part of the document's address. */
const PAGES_TICKET='_pt';

/** The parent reloads instead. */
export class VersionRefused extends Error {}
const refuse=(why:string)=>new VersionRefused(why);

/** Where the core keeps the HTML this document loaded (lib/html-runtime/build.server, captured at readyState interactive). */
export const LOADED_SOURCE=Symbol.for('afbin.loaded-source');

interface Runtime {revision?:string;savedNodeIds?:string[];scriptFingerprint?:string}
const runtimeOf=(doc:Document):Runtime=>{try{return JSON.parse(doc.querySelector('script[data-af="runtime"]')?.textContent??'{}') as Runtime;}catch{return {};}};
const ID='data-af-id';
const INTERACTIVE=new Set(['button','input','select','textarea','form','a','details','summary','option','optgroup','datalist','dialog','label','output','iframe','object','embed','video','audio','canvas']);

/** An element whose behaviour a script, the browser or a component wires: never redrawn under it. */
export function interactive(element:Element):boolean{
 if(INTERACTIVE.has(element.localName)||element.localName.includes('-')||element.hasAttribute('contenteditable'))return true;
 for(const attr of element.attributes){const name=attr.name.toLowerCase();if(name.startsWith('on')||name==='data-af'||name.startsWith('data-af-')&&name!==ID)return true;}
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
/** What changed between the loaded and the new source, or why it must reload. `scripts` is the page's script text, null when some of it could not be read. */
export function planVersion(loaded:Document,next:Document,scripts:string|null,oldIds?:readonly string[]):VersionPlan{
 const current=runtimeOf(loaded),incoming=runtimeOf(next);
 if(!incoming.scriptFingerprint||incoming.scriptFingerprint!==current.scriptFingerprint)throw refuse('the new version runs different scripts');
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
 for(const element of [...touched,...removed]){
  for(let at:Element|null=element;at&&at.localName!=='body'&&at.localName!=='head';at=at.parentElement)
   if(interactive(at))throw refuse(`an interactive element changed (<${at.localName}>)`);
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
function applyAttributes(live:Element,before:Element|undefined,after:Element):void{
 // A script that ran is not changed by its attributes; equal fingerprints say its code did not change.
 if(live.localName==='script')return;
 for(const attr of after.attributes){const was=before?.getAttribute(attr.name);if((was===null||was===undefined||was!==unpinned(attr.name,attr.value))&&live.getAttribute(attr.name)!==attr.value)live.setAttribute(attr.name,attr.value);}
 if(before)for(const attr of before.attributes)if(!after.hasAttribute(attr.name))live.removeAttribute(attr.name);
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

/** Draw `next` (served HTML) over the running document that loaded `loaded`. Throws VersionRefused, or anything the DOM throws. */
export function morphHtmlVersion(doc:Document,loaded:string,next:string,scripts:string|null,oldIds?:readonly string[]):{revision:string;savedNodeIds:string[]}{
 // Compared unpinned; drawn from the served bytes as they are.
 const parser=new DOMParser(),before=unpin(parser.parseFromString(loaded,'text/html')),after=parser.parseFromString(next,'text/html');
 const plan=planVersion(before,unpin(parser.parseFromString(next,'text/html')),scripts,oldIds);
 const source=(element:Element)=>{const id=element.getAttribute(ID);return id&&(plan.oldIds.has(id)||plan.newIds.has(id))?id:'';};
 // Script-made and platform nodes stay where they are: never matched, moved or removed.
 const kept=new Set<Node>([...doc.body.querySelectorAll('*')].filter(element=>!plan.oldIds.has(element.getAttribute(ID)??'')));
 const ctx:MorphContext={keep:new Map(),oldUnits:new Map(),used:new Set(),kept,held:heldNodes(doc.body),stableElementIds:plan.stable,idOf:source,
  syncAttributes:(live,incoming)=>{const id=source(incoming);applyAttributes(live,id?plan.before.get(id):undefined,incoming);}};
 syncHead(doc,plan,after);
 applyAttributes(doc.documentElement,before.documentElement,after.documentElement);
 applyAttributes(doc.body,before.body,after.body);
 morphChildren(doc.body,after.body,ctx);
 const runtime=runtimeOf(after);
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

export interface VersionApplied {revision:string;savedNodeIds:string[]}
/**
 * Fetch the newest served version the way this frame got its document (its own address, its own session) and draw it in
 * place. Resolves with the version drawn; rejects (VersionRefused or any error) when the parent must reload.
 */
export async function applyHtmlVersion(win:Window,config:{revision:string;savedNodeIds?:readonly string[]},version:number,fetchFn:typeof fetch=win.fetch.bind(win)):Promise<VersionApplied>{
 const holder=win as unknown as Record<symbol,unknown>,loaded=holder[LOADED_SOURCE];
 if(typeof loaded!=='string')throw refuse('this document kept no copy of its source');
 const address=new URL(win.location.href);address.searchParams.delete(PAGES_TICKET);address.hash='';
 // Marked so the read is not counted as another view of the page (app/a/[id]/raw).
 const response=await fetchFn(address.href,{credentials:'same-origin',cache:'no-store',headers:{[LIVE_VERSION_HEADER]:'1'}});
 if(!response.ok)throw refuse(`the new version answered ${response.status}`);
 const next=await response.text();
 const revision=Number(runtimeOf(new DOMParser().parseFromString(next,'text/html')).revision);
 if(!Number.isInteger(revision)||revision<version)throw refuse('the served version is not the published one');
 const applied=morphHtmlVersion(win.document,loaded,next,await pageScripts(win.document,fetchFn),config.savedNodeIds);
 holder[LOADED_SOURCE]=next;
 return applied;
}
