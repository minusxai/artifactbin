import type {HtmlDatasetLink} from '@artifactbin/contracts';
import type {HtmlPageDeclarations} from './links-contracts';
import { parse, serialize } from 'parse5';
import { applyEdits, attribute, atHeadStart, insertAttribute, parseSource, removeElement, written } from './html-source';
import type { CanonicalHtmlOptions, CanonicalHtmlPage,HtmlPageMetadata } from './contracts';
export type { HtmlIdentityLedger, CanonicalHtmlOptions, CanonicalHtmlPage } from './contracts';
const CORE='/af/v1/core.js';
const allElements=(html:string)=>{const document=parseSource(html);return {...document,all:[...document.elements,...document.templateElements]};};
/** The persisted source is the authoring source. Runtime wrappers never enter it. */
export function canonicalizeHtmlPage(input:string, options:CanonicalHtmlOptions={}):CanonicalHtmlPage {
 if(typeof input!=='string'||!input.trim())throw new Error('HTML source is required');
 if(input.length>4_000_000)throw new Error('HTML source is too large');
 let html=input;
 // Materialize implied html/head/body so every actual element receives an identity.
 if(parseSource(html).elements.some(element=>!written(element)))html=serialize(parse(html));
 let document=allElements(html);
 const cores=document.all.filter(element=>element.tagName==='script'&&(attribute(element,'data-af')==='core'||attribute(element,'src')===CORE));
 const firstScript=document.elements.find(element=>element.tagName==='script');
 const valid=cores.length===1&&cores[0]===firstScript&&cores[0]?.parentNode===document.head&&attribute(cores[0],'src')===CORE&&attribute(cores[0],'async')===null&&attribute(cores[0],'defer')===null&&attribute(cores[0],'type')===null;
 if(!valid){
  const retained=cores[0]&&attribute(cores[0],'data-af-id');
  html=applyEdits(html,cores.map(element=>removeElement(html,element)));
  document=allElements(html);
  html=applyEdits(html,[atHeadStart(document,[`<script src="${CORE}"${retained?` data-af-id="${retained.replaceAll('&','&amp;').replaceAll('"','&quot;')}"`:''}></script>`])]);
 }
 document=allElements(html);
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
 for(const element of document.all){
  if(attribute(element,'data-af-id')!==null)continue;
  let id:string;do{id=`af-${next++}`;}while(allocated.has(id));
  seen.add(id);allocated.add(id);edits.push(insertAttribute(html,element,'data-af-id',id));
 }
 html=applyEdits(html,edits);
 htmlPageDeclarations(html);
 return {html,ledger:{allocatedIds:[...allocated],nextNodeId:next},nodeIds:[...seen]};
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
