/** Source-side helpers only. Reader receives an AST and never imports a parser. */
import type {JsxElement, JsxNode} from '@/lib/jsx/types';
import {parseJsx} from '@/lib/jsx/parse';
import {parse} from 'acorn';
import {compileManagedIframe} from './managed-iframe';
import {remapViewportHeightUnits} from '@/lib/story-surface/viewport-units';

/** Inline syntax is checked at SAVE only; author source remains inert in the reader. */
export function validateManagedIframeSource(node:JsxElement):void {
  for(const script of compileManagedIframe(node).scripts)if(script.source!==undefined) {
    try{parse(script.source,{ecmaVersion:'latest',sourceType:script.type==='module'?'module':'script'});}
    catch(error){throw new Error(`Iframe: invalid script: ${error instanceof Error?error.message:String(error)}`);}
  }
}

/** Apply parent-only source transforms without changing bytes inside managed frames. */
export function transformOutsideManagedIframes(source:string, transform:(source:string)=>string):string {
  const parsed=parseJsx(source);
  if(!parsed.ok)return transform(source);
  const frames:JsxElement[]=[];
  const walk=(nodes:JsxNode[])=>{for(const node of nodes)if(node.type==='element'){if(node.tag==='Iframe')frames.push(node);else walk(node.children);}};
  walk(parsed.nodes);
  let cursor=0;
  let result='';
  for(const frame of frames){result+=transform(source.slice(cursor,frame.start))+source.slice(frame.start,frame.end);cursor=frame.end;}
  return result+transform(source.slice(cursor));
}

/** Parent authored style blocks adopt the document viewport; isolated styles do not. */
export function remapMarkupStyleViewportUnits(markup:string):string {
  return transformOutsideManagedIframes(markup, source => source.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_m,open:string,css:string,close:string)=>`${open}${remapViewportHeightUnits(css)}${close}`));
}
