import { parse, serialize } from 'parse5';
import { applyEdits, attribute, atHeadStart, insertAttribute, parseSource, removeElement, written } from './html-source';
import type { CanonicalHtmlOptions, CanonicalHtmlPage } from './contracts';
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
 return {html,ledger:{allocatedIds:[...allocated],nextNodeId:next},nodeIds:[...seen]};
}
/** A backend namespace is declared in HTML, never inferred from a network URL. */
export function htmlBackendNames(html:string):string[]{
 const names:string[]=[];
 for(const element of allElements(html).all){
  if(element.tagName!=='link'||!(attribute(element,'rel')??'').split(/\s+/).includes('af-backend'))continue;
  const name=attribute(element,'data-af-name');
  if(!name||!/^[_A-Za-z][_0-9A-Za-z]*$/.test(name)||name.startsWith('__'))throw new Error('Invalid backend namespace');
  if(names.includes(name))throw new Error('Duplicate backend namespace');names.push(name);
 }
 return names;
}
