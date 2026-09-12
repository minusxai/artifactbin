/** Source-side helpers only. Reader receives an AST and never imports a parser. */
import type {JsxElement, JsxNode} from '@/lib/jsx/types';
import {parseJsx} from '@/lib/jsx/parse';
import {parse} from 'acorn';
import {compileManagedIframe} from './managed-iframe';
import {remapStyleBlockViewportUnits} from '@/lib/story-surface/viewport-units';

/** Inline syntax is checked at SAVE only; author source remains inert in the reader. */
function validateManagedIframeSource(node:JsxElement):void {
  for(const script of compileManagedIframe(node).scripts)if(script.source!==undefined) {
    try{parse(script.source,{ecmaVersion:'latest',sourceType:script.type==='module'?'module':'script'});}
    catch(error){throw new Error(`Iframe: invalid script: ${error instanceof Error?error.message:String(error)}`);}
  }
}

/** Save-only syntax validation, deliberately outside the reader's validator graph. */
export function managedIframeSourceErrors(nodes:JsxNode[]):Array<{message:string;tag:string;start:number;end:number}> {
  const errors:Array<{message:string;tag:string;start:number;end:number}>=[];
  const walk=(items:JsxNode[])=>{for(const node of items)if(node.type==='element'){
    if(node.tag==='Iframe'){try{validateManagedIframeSource(node);}catch(error){errors.push({message:error instanceof Error?error.message:String(error),tag:node.tag,start:node.start,end:node.end});}}
    else walk(node.children);
  }};
  walk(nodes);return errors;
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
  return transformOutsideManagedIframes(markup, remapStyleBlockViewportUnits);
}
