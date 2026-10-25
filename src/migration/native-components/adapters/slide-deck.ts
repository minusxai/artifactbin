import type { NativeLowerBlocker } from '../lower.ts';
import type { NativeComponentRule } from '../component-map.ts';
import type { RetainedAttribute, RetainedJsxNode, RetainedStaticValue } from '../analyze-contracts.ts';

/** Pure normalization result for the source SlideDeck/Slide wrappers. */
export interface NativeSlideDeckPreparation {
  readonly node: RetainedJsxNode;
  readonly blockers: readonly NativeLowerBlocker[];
}

const genericSourceProps = new Set([
  'id','class','className','title','role','tabIndex','hidden','inert','slot','lang','dir','style',
]);
const safeName = (name:string):boolean => genericSourceProps.has(name)||/^aria-[a-z][a-z0-9-]*$/.test(name)||/^data-[a-z0-9_-]+$/.test(name);
const styleShape = (value:unknown):boolean => !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([name,item])=>
  /^[-a-zA-Z]+$/.test(name)&&(typeof item==='string'||typeof item==='number'&&Number.isFinite(item)));

/** Source components only forward global HTMLElement props; selection is owned by the reader host. */
const sourceAttributes:Readonly<Record<string,NativeComponentRule['attributes']>>={
  SlideDeck:{id:'string',class:'string',className:'string',title:'string',role:'string',tabIndex:'number',hidden:'boolean',inert:'boolean',slot:'string',lang:'string',dir:'string',label:'string'},
  Slide:{id:'string',class:'string',className:'string',title:'string',role:'string',tabIndex:'number',hidden:'boolean',inert:'boolean',slot:'string',lang:'string',dir:'string'},
};

/** Rules match the target's existing registerSlideDeck module; this adapter adds no rail or controls. */
export const NATIVE_SLIDE_DECK_RULES: readonly NativeComponentRule[] = Object.freeze([
  Object.freeze({tag:'SlideDeck',htmlTag:'af-slide-deck',kind:'native',module:'slide-deck',register:'registerSlideDeck',attributes:sourceAttributes.SlideDeck}),
  Object.freeze({tag:'Slide',htmlTag:'af-slide',kind:'native',module:'slide-deck',register:'registerSlideDeck',attributes:sourceAttributes.Slide,parent:['SlideDeck']}),
]);

const isElement=(node:RetainedJsxNode):node is Extract<RetainedJsxNode,{type:'element'}>=>node.type==='element';
const staticString=(attr:RetainedAttribute|undefined):string|undefined=>attr?.value.static&&typeof attr.value.json==='string'?attr.value.json:undefined;
const attr=(node:Extract<RetainedJsxNode,{type:'element'}>,name:string):RetainedAttribute|undefined=>node.attributes.find(value=>value.name===name);
const textOf=(node:RetainedJsxNode):string=>node.type==='text'?node.value:node.type==='expression'?(node.value.static&&typeof node.value.json==='string'?node.value.json:''):node.children.map(textOf).join('');
const firstHeading=(nodes:readonly RetainedJsxNode[]):string|undefined=>{
  for(const node of nodes){
    if(!isElement(node))continue;
    if(!node.isComponent&&/^h[1-6]$/i.test(node.tag)){
      const value=textOf(node).trim();if(value)return value;
    }
    const nested=firstHeading(node.children);if(nested)return nested;
  }
};
const discoveredSlides=(nodes:readonly RetainedJsxNode[]):Extract<RetainedJsxNode,{type:'element'}>[]=>(
  nodes.flatMap(node=>{
    if(!isElement(node))return [];
    if(node.isComponent&&node.tag==='Slide')return [node];
    return discoveredSlides(node.children);
  })
);
const visit=(node:RetainedJsxNode,fn:(element:Extract<RetainedJsxNode,{type:'element'}>)=>void):void=>{
  if(!isElement(node))return;fn(node);node.children.forEach(child=>visit(child,fn));
};
const blocker=(node:RetainedJsxNode,code:string,detail:string,attribute?:string):NativeLowerBlocker=>({code,sourceNode:node.graphKey,tag:isElement(node)?node.tag:undefined,detail,...attribute?{attribute}:{}});
const clone=(node:Extract<RetainedJsxNode,{type:'element'}>,patch:Partial<Pick<Extract<RetainedJsxNode,{type:'element'}>,'tag'|'isComponent'|'attributes'|'children'>>):RetainedJsxNode=>({...node,...patch});
const generatedAttribute=(source:RetainedJsxNode,name:string,value:RetainedStaticValue):RetainedAttribute=>({name,value,start:source.start,end:source.end});
const addIfAbsent=(attrs:RetainedAttribute[],node:RetainedJsxNode,name:string,value:RetainedStaticValue):RetainedAttribute[]=>attrs.some(item=>item.name===name)?attrs:[...attrs,generatedAttribute(node,name,value)];
const literal=(json:unknown):RetainedStaticValue=>({static:true,json:json as RetainedStaticValue extends {static:true;json:infer J}?J:never});

const validateProps=(node:RetainedJsxNode,blockers:NativeLowerBlocker[]):void=>visit(node,element=>{
  if(!element.isComponent||!['SlideDeck','Slide'].includes(element.tag))return;
  const seen=new Set<string>();
  for(const attribute of element.attributes){
    if(seen.has(attribute.name)){blockers.push(blocker(element,'duplicate-slide-prop','Repeated source wrapper properties are ambiguous',attribute.name));continue;}
    seen.add(attribute.name);
    if(!safeName(attribute.name))blockers.push(blocker(element,'unsupported-slide-deck-prop','The source SlideDeck/Slide wrapper only accepts the retained HTML global attributes; executable and target-only props are not source semantics',attribute.name));
    else if(attribute.name==='style'&&attribute.value.static&&!styleShape(attribute.value.json))blockers.push(blocker(element,'invalid-slide-style','Source style must be a static CSS property object',attribute.name));
  }
});

const railSlide=(node:Extract<RetainedJsxNode,{type:'element'}>):RetainedJsxNode=>{
  const titleAttr=attr(node,'title');
  const authored=staticString(titleAttr);
  const title=(authored?.trim()||firstHeading(node.children));
  const attributes=node.attributes.filter(value=>value.name!=='title');
  const withTitle=title?addIfAbsent(attributes,node,'title',literal(title)):attributes;
  return clone(node,{tag:'Slide',isComponent:true,attributes:withTitle,children:node.children.map(child=>normalizeNested(child))});
};
const sourceSection=(node:Extract<RetainedJsxNode,{type:'element'}>):RetainedJsxNode=>{
  const titleAttr=attr(node,'title');
  let attributes=node.attributes.filter(value=>value.name!=='title');
  attributes=addIfAbsent(attributes,node,'data-mx-slide',literal(''));
  if(titleAttr)attributes=addIfAbsent(attributes,node,'data-mx-slide-title',titleAttr.value);
  return clone(node,{tag:'section',isComponent:false,attributes,children:node.children.map(child=>normalizeNested(child))});
};
const normalizeNested=(node:RetainedJsxNode):RetainedJsxNode=>{
  if(!isElement(node))return node;
  if(node.isComponent&&node.tag==='Slide')return sourceSection(node);
  return clone(node,{children:node.children.map(normalizeNested)});
};

/**
 * Normalize source reader slides without evaluating retained expressions. The
 * reader only discovers a Slide's first occurrence, and only adds a rail for
 * two or more source slides. A single-slide source deck therefore remains the
 * original div/section structure instead of acquiring target-only chrome.
 */
export function prepareNativeSlideDeck(node:RetainedJsxNode):NativeSlideDeckPreparation {
  const blockers:NativeLowerBlocker[]=[];validateProps(node,blockers);
  visit(node,element=>{
    if(!element.isComponent||element.tag!=='Slide')return;
    const title=attr(element,'title');
    if(title&&!title.value.static)blockers.push(blocker(element,'dynamic-slide-title','Source rail discovery uses only static authored titles; retain heading fallback or reject dynamic title binding explicitly','title'));
    else if(title?.value.static&&typeof title.value.json!=='string')blockers.push(blocker(element,'invalid-slide-title','The source Slide title prop is a string','title'));
  });
  if(blockers.length)return {node,blockers};
  if(!isElement(node))return {node,blockers};
  if(node.isComponent&&node.tag==='SlideDeck'){
    let count=0;const topSlides=new Set(discoveredSlides(node.children).map(slide=>slide.graphKey));count=topSlides.size;
    const rail=count>=2;
    const children=node.children.map(child=>normalizeDeckChild(child,rail,false));
    const attrs=rail?node.attributes.map(value=>value.name==='aria-label'?{...value,name:'label'}:value):node.attributes;
    return {node:clone(node,{tag:rail?'SlideDeck':'div',isComponent:rail,attributes:attrs,children}),blockers};
  }
  const unhosted=discoveredSlides([node]);
  if(unhosted.length>=2)return {node,blockers:[blocker(node,'slide-deck-host-required','Multiple source Slides outside a SlideDeck require the reader host to provide the existing native slide-deck wrapper')]};
  return {node:normalizeNested(node),blockers};
}

const normalizeDeckChild=(node:RetainedJsxNode,rail:boolean,inSlide:boolean):RetainedJsxNode=>{
  if(!isElement(node))return node;
  if(node.isComponent&&node.tag==='Slide'){
    if(inSlide)return sourceSection(node);
    if(!rail)return sourceSection(node);
    return clone(railSlide(node) as Extract<RetainedJsxNode,{type:'element'}>,{children:node.children.map(child=>normalizeDeckChild(child,rail,true))});
  }
  if(node.isComponent&&node.tag==='SlideDeck')return clone(node,{tag:'div',isComponent:false,children:node.children.map(child=>normalizeDeckChild(child,rail,inSlide))});
  return clone(node,{children:node.children.map(child=>normalizeDeckChild(child,rail,inSlide))});
};
