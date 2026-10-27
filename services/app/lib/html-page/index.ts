import type {HtmlDatasetLink} from '@artifactbin/contracts';
import type {HtmlPageDeclarations} from './links-contracts';
import { parse, serialize } from 'parse5';
import { applyEdits, attribute, atHeadStart, insertAttribute, parseSource, removeElement, written } from './html-source.ts';
import type { CanonicalHtmlOptions, CanonicalHtmlPage,HtmlPageMetadata,HtmlPwaSettings,HtmlAssetLinks } from './contracts';
export type { HtmlIdentityLedger, CanonicalHtmlOptions, CanonicalHtmlPage,HtmlPwaSettings } from './contracts';
const CORE='/af/v1/core.js';
const allElements=(html:string)=>{const document=parseSource(html);return {...document,all:[...document.elements,...document.templateElements]};};
type SourceElement=import('./html-source').Element;
/** The one blocking core the server requires: exactly one, first script in <head>, plain src. Shared by publish and autofix. */
export function repairCoreScript(input:string):{html:string;changed:boolean;removed:SourceElement[]}{
 let html=input,document=allElements(html);
 const cores=document.all.filter(element=>element.tagName==='script'&&(attribute(element,'data-af')==='core'||attribute(element,'src')===CORE));
 const firstScript=document.elements.find(element=>element.tagName==='script');
 const valid=cores.length===1&&cores[0]===firstScript&&cores[0]?.parentNode===document.head&&attribute(cores[0],'src')===CORE&&attribute(cores[0],'async')===null&&attribute(cores[0],'defer')===null&&attribute(cores[0],'type')===null;
 if(valid)return {html,changed:false,removed:[]};
 const retained=cores[0]&&attribute(cores[0],'data-af-id');
 html=applyEdits(html,cores.map(element=>removeElement(html,element)));
 document=allElements(html);
 html=applyEdits(html,[atHeadStart(document,[coreTag(retained)])]);
 return {html,changed:true,removed:cores};
}
const coreTag=(id?:string|null)=>`<script src="${CORE}"${id?` data-af-id="${id.replaceAll('&','&amp;').replaceAll('"','&quot;')}"`:''}></script>`;

/** The persisted source is the authoring source. Runtime wrappers never enter it. */
export function canonicalizeHtmlPage(input:string, options:CanonicalHtmlOptions={}):CanonicalHtmlPage {
 if(typeof input!=='string'||!input.trim())throw new Error('HTML source is required');
 if(input.length>4_000_000)throw new Error('HTML source is too large');
 let html=input;
 // Materialize implied html/head/body so every actual element receives an identity.
 if(parseSource(html).elements.some(element=>!written(element)))html=serialize(parse(html));
 html=repairCoreScript(html).html;
 const document=allElements(html);
 const previous=new Set(options.previousHtml?allElements(options.previousHtml).all.map(element=>attribute(element,'data-af-id')).filter((id):id is string=>id!==null):[]);
 const allocated=new Set(options.ledger?.allocatedIds??previous);
 const seen=new Set<string>();
 for(const element of document.all){
  const id=attribute(element,'data-af-id');
  if(id===null)continue;
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(id))throw new Error('Invalid data-af-id');
  if(seen.has(id))throw new Error(`Duplicate data-af-id: ${id}`);
  if(allocated.has(id)&&!previous.has(id))throw new Error(`Cannot reuse retired data-af-id: ${id}`);
  seen.add(id);allocated.add(id);
 }
 let next=options.ledger?.nextNodeId??1;
 const edits=[];
 const missing=document.all.filter(element=>attribute(element,'data-af-id')===null);
 // A regenerated file without IDs keeps the previous version's identities for elements it still has (D11).
 const carried=options.previousHtml&&missing.length?carryForwardIds(allElements(options.previousHtml),document,seen):new Map<SourceElement,string>();
 for(const element of missing){
  const kept=carried.get(element);
  if(kept){seen.add(kept);edits.push(insertAttribute(html,element,'data-af-id',kept));continue;}
  let id:string;do{id=`af-${next++}`;}while(allocated.has(id));
  seen.add(id);allocated.add(id);edits.push(insertAttribute(html,element,'data-af-id',id));
 }
 html=applyEdits(html,edits);
 htmlPageDeclarations(html);
 return {html,ledger:{allocatedIds:[...allocated],nextNodeId:next},nodeIds:[...seen],...(options.previousHtml&&missing.length?{carry:{carried:carried.size,fresh:missing.length-carried.size}}:{})};
}

type Parsed=ReturnType<typeof allElements>;
interface Counterpart {id:string;tag:string;parent:string;index:number;path:string;text:string;attrs:string;grams?:Map<string,number>;attrGrams?:Map<string,number>}
const SIGNATURE_ATTRIBUTES=['class','src','href','name','type','rel','content','alt','charset','property','data-af','role','aria-label','for','value'];
const textOf=(node:import('./html-source').Element|ParentLike):string=>{let out='';const walk=(n:any)=>{if(out.length>600)return;if(n.nodeName==='#text')out+=n.value;else if(n.childNodes)for(const c of n.childNodes)walk(c);if(n.content)walk(n.content);};walk(node);return out.replace(/\s+/g,' ').trim().slice(0,400);};
type ParentLike={childNodes:unknown[]};
const bigrams=(value:string)=>{const grams=new Map<string,number>();for(let i=0;i<value.length-1;i++){const gram=value.slice(i,i+2);grams.set(gram,(grams.get(gram)??0)+1);}return grams;};
function dice(a:string,b:string,ga:Map<string,number>,gb:Map<string,number>):number{
 if(a===b)return 1;if(a.length<2||b.length<2)return 0;
 let shared=0;for(const [gram,count] of ga)shared+=Math.min(count,gb.get(gram)??0);
 return 2*shared/(a.length-1+b.length-1);
}
/** Structural facts about each element: nearest identified ancestor, index among same-tag siblings, tag path. */
function describe(document:Parsed,idOf:(element:SourceElement)=>string|undefined){
 const owners=new Map<unknown,SourceElement>();
 for(const element of document.all)if(element.tagName==='template'&&'content' in element)owners.set((element as unknown as {content:unknown}).content,element);
 const parentOf=(element:SourceElement):SourceElement|null=>{const parent=element.parentNode as unknown;if(!parent)return null;if(owners.has(parent))return owners.get(parent)!;return parent&&typeof parent==='object'&&'tagName' in parent?parent as SourceElement:null;};
 const indexOf=(element:SourceElement)=>{const parent=element.parentNode as unknown as {childNodes?:SourceElement[]}|null;let index=0;for(const sibling of parent?.childNodes??[]){if(sibling===element)return index;if(sibling.tagName===element.tagName)index++;}return index;};
 const pathOf=(element:SourceElement)=>{const tags=[];for(let at:SourceElement|null=element;at;at=parentOf(at))tags.push(at.tagName);return tags.reverse().join('>');};
 const parentId=(element:SourceElement)=>{for(let at=parentOf(element);at;at=parentOf(at)){const id=idOf(at);if(id!==undefined)return id;if(attribute(at,'data-af-id')===null)return '';}return '';};
 const attrs=(element:SourceElement)=>SIGNATURE_ATTRIBUTES.map(name=>attribute(element,name)??'').join('|').replace(/\|+$/,'');
 return {parentOf,indexOf,pathOf,parentId,attrs};
}
/**
 * Match each element without an ID to its counterpart in the previous version: same tag under the same identified
 * parent with the same or very similar text (or the same position), then a unique exact text, then a similar text at the
 * same tag path. Only previous IDs not already written are reused, each once; unmatched elements get fresh IDs.
 */
function carryForwardIds(previous:Parsed,next:Parsed,taken:ReadonlySet<string>):Map<SourceElement,string>{
 const before=describe(previous,element=>attribute(element,'data-af-id')??undefined);
 const candidates:Counterpart[]=[];
 for(const element of previous.all){const id=attribute(element,'data-af-id');if(id===null)continue;candidates.push({id,tag:element.tagName,parent:before.parentId(element),index:before.indexOf(element),path:before.pathOf(element),text:textOf(element),attrs:before.attrs(element)});}
 const byParent=new Map<string,Counterpart[]>(),byText=new Map<string,Counterpart[]>(),byTag=new Map<string,Counterpart[]>();
 const add=(map:Map<string,Counterpart[]>,key:string,value:Counterpart)=>{const list=map.get(key);if(list)list.push(value);else map.set(key,[value]);};
 for(const candidate of candidates){add(byParent,candidate.parent+'\0'+candidate.tag,candidate);if(candidate.text)add(byText,candidate.tag+'\0'+candidate.text,candidate);add(byTag,candidate.tag,candidate);}
 const used=new Set(taken),carried=new Map<SourceElement,string>(),ids=new Map<SourceElement,string>();
 const after=describe(next,element=>ids.get(element)??attribute(element,'data-af-id')??undefined);
 const similarity=(candidate:Counterpart,text:string,attrs:string,grams:Map<string,number>,attrGrams:Map<string,number>)=>{
  if(candidate.text||text)return dice(candidate.text,text,candidate.grams??=bigrams(candidate.text),grams);
  return attrs===candidate.attrs?1:dice(candidate.attrs,attrs,candidate.attrGrams??=bigrams(candidate.attrs),attrGrams);
 };
 for(const element of next.all){
  const written=attribute(element,'data-af-id');if(written!==null){ids.set(element,written);continue;}
  const tag=element.tagName;let match:Counterpart|undefined;
  if(['html','head','body'].includes(tag))match=byTag.get(tag)?.find(candidate=>!used.has(candidate.id));
  else{
   const text=textOf(element),attrs=after.attrs(element),grams=bigrams(text),attrGrams=bigrams(attrs),index=after.indexOf(element);
   let best=-1;
   for(const candidate of byParent.get(after.parentId(element)+'\0'+tag)??[]){
    if(used.has(candidate.id))continue;const score=similarity(candidate,text,attrs,grams,attrGrams);
    if((score>=0.5||candidate.index===index&&score>=0.25)&&score+(candidate.index===index?0.3:0)>best){best=score+(candidate.index===index?0.3:0);match=candidate;}
   }
   if(!match&&text){const exact=(byText.get(tag+'\0'+text)??[]).filter(candidate=>!used.has(candidate.id));if(exact.length===1)match=exact[0];}
   if(!match){
    const path=after.pathOf(element);let checked=0;
    for(const candidate of byTag.get(tag)??[]){
     if(used.has(candidate.id)||candidate.path!==path)continue;if(++checked>400)break;
     const score=similarity(candidate,text,attrs,grams,attrGrams);if(score>=0.75&&score>best){best=score;match=candidate;}
    }
   }
  }
  if(match){used.add(match.id);ids.set(element,match.id);carried.set(element,match.id);}
 }
 return carried;
}
/** Namespaces are declarations, never inferred from arbitrary network URLs. */
export function htmlPageDeclarations(html:string):HtmlPageDeclarations{
 const backends:string[]=[];const datasets:HtmlDatasetLink[]=[];const names=new Set<string>();
 for(const element of allElements(html).all){
  if(element.tagName!=='link')continue;
  const rel=(attribute(element,'rel')??'').split(/\s+/);
  const backend=rel.includes('af-backend'),dataset=rel.includes('af-dataset');
  if(!backend&&!dataset)continue;
  if(backend&&dataset)throw new Error('A link declares one namespace kind');
  const name=attribute(element,'data-af-name');
  if(!name||!/^[_A-Za-z][_0-9A-Za-z]*$/.test(name)||name.startsWith('__'))throw new Error('Invalid namespace');
  if(names.has(name))throw new Error('Duplicate namespace');names.add(name);
  if(names.size>20)throw new Error('Too many namespaces');
  if(backend){backends.push(name);continue;}
  const match=/^ref:([A-Za-z0-9]{6,128})$/.exec(attribute(element,'href')??'');
  if(!match)throw new Error('Dataset href must name an artifact as ref:<id>');
  const mode=attribute(element,'data-af-mode')??'live';
  const revision=attribute(element,'data-af-revision');
  if(mode==='live'&&revision===null)datasets.push({kind:'dataset',name,datasetId:match[1]!,mode:'live'});
  else if(mode==='pinned'&&revision&&/^[1-9]\d*$/.test(revision)&&Number.isSafeInteger(Number(revision)))datasets.push({kind:'dataset',name,datasetId:match[1]!,mode:'pinned',revision});
  else throw new Error('Dataset link requires live mode or pinned mode with a valid revision');
 }
 return {backends,datasets};
}
export function htmlBackendNames(html:string):string[]{return [...htmlPageDeclarations(html).backends];}

/** The native head supplies listing and share metadata; body content is never executed. */
export function htmlPageMetadata(html:string):HtmlPageMetadata{
 const document=parseSource(html);let title:string|null=null,description:string|null=null;
 for(const element of document.elements){
  let inHead=false;for(let parent=element.parentNode;parent;parent='parentNode' in parent?parent.parentNode:null)if(parent===document.head){inHead=true;break;}
  if(!inHead)continue;
  if(element.tagName==='title'&&title===null){
   const text=element.childNodes.filter(node=>node.nodeName==='#text').map(node=>'value' in node?node.value:'').join('').replace(/\s+/g,' ').trim();title=text||null;
  }
  if(element.tagName==='meta'&&(attribute(element,'name')??'').toLowerCase()==='description'&&description===null)description=attribute(element,'content')?.trim()||null;
 }
 return {title,description};
}

/** Read static head metadata only; scripts and template content never declare install policy. */
export function htmlPwaSettings(html:string):HtmlPwaSettings {
 const {head,elements}=parseSource(html),settings:HtmlPwaSettings={};
 const fields={enabled:'enabled',name:'name','short-name':'shortName',icon:'icon','theme-color':'themeColor','background-color':'backgroundColor'} as const;
 for(const element of elements){
  if(element.tagName!=='meta'||element.parentNode!==head)continue;
  const name=attribute(element,'name'),value=attribute(element,'content');if(!name?.startsWith('artifactbin:pwa-')||value===null)continue;
  const field=fields[name.slice('artifactbin:pwa-'.length) as keyof typeof fields];if(!field)continue;
  if(field==='enabled'){if(value==='true'||value==='false')settings.enabled=value==='true';}
  else if(field==='icon'){if(/^ref:[a-zA-Z0-9]{6,12}$/.test(value))settings.icon=value.slice(4);}
  else if(field==='themeColor'||field==='backgroundColor'){if(/^#[0-9a-fA-F]{6}$/.test(value))settings[field]=value;}
  else if(value.trim()&&value.length<=(field==='shortName'?30:100))settings[field]=value;
 }
 return settings;
}

const assetAttributes=(element:import('./html-source').Element):string[]=>element.tagName==='img'||element.tagName==='source'?['src']:element.tagName==='video'?['poster']:element.tagName==='a'?['href']:[];
/** Only byte-bearing HTML attributes are asset references; backend links and script text are excluded. */
export function htmlAssetLinks(html:string):HtmlAssetLinks {
 const refs=new Set<string>(),imageUrls=new Set<string>();
 for(const element of parseSource(html).elements)for(const name of assetAttributes(element)){
  const value=attribute(element,name);if(!value)continue;
  if(/^ref:[a-zA-Z0-9]{6,12}$/.test(value))refs.add(value.slice(4));
  else if(element.tagName!=='a'&&/^https?:\/\//.test(value))imageUrls.add(value);
 }
 return {refs:[...refs],imageUrls:[...imageUrls]};
}
/** Presentation-only URL changes leave saved source, identities and downloaded files untouched. */
export function rewriteHtmlAssetUrls(html:string,replacements:ReadonlyMap<string,string>):string {
 const edits:import('./html-source').Edit[]=[];
 for(const element of parseSource(html).elements)for(const name of assetAttributes(element)){
  const value=attribute(element,name),next=value&&replacements.get(value),location=element.sourceCodeLocation?.attrs?.[name];
  if(next&&location)edits.push({start:location.startOffset,end:location.endOffset,text:`${name}="${next.replaceAll('&','&amp;').replaceAll('"','&quot;')}"`});
 }
 return applyEdits(html,edits);
}
