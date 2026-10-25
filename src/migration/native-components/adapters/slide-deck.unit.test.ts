import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_SLIDE_DECK_RULES,prepareNativeSlideDeck} from './slide-deck.ts';
import type {NativeJson,RetainedJsxNode,RetainedStaticValue} from '../analyze-contracts.ts';

type ElementNode=Extract<RetainedJsxNode,{type:'element'}>;
let sequence=0;
const literal=(json:NativeJson):RetainedStaticValue=>({static:true,json});
const element=(tag:string,attrs:Record<string,RetainedStaticValue>={},children:RetainedJsxNode[]=[],isComponent=true):ElementNode=>({
 type:'element',tag,isComponent,selfClosing:children.length===0,graphKey:`node-${++sequence}`,start:sequence*10,end:sequence*10+5,
 attributes:Object.entries(attrs).map(([name,value],i)=>({name,value,start:sequence*10+i,end:sequence*10+i+1})),children,
});
const text=(value:string):RetainedJsxNode=>({type:'text',value,graphKey:`text-${++sequence}`,start:sequence*10,end:sequence*10+5});
const attr=(node:ElementNode,name:string):RetainedStaticValue|undefined=>node.attributes.find(value=>value.name===name)?.value;
const json=(node:ElementNode,name:string):NativeJson|undefined=>{const value=attr(node,name);return value?.static?value.json:undefined;};
const childElements=(node:RetainedJsxNode):ElementNode[]=>node.type==='element'?node.children.filter((child):child is ElementNode=>child.type==='element'):[];

test('maps the source components to the existing target elements and control module',()=>{
 assert.deepEqual(NATIVE_SLIDE_DECK_RULES.map(({tag,htmlTag,module,register,parent})=>({tag,htmlTag,module,register,parent})),[
  {tag:'SlideDeck',htmlTag:'af-slide-deck',module:'slide-deck',register:'registerSlideDeck',parent:undefined},
  {tag:'Slide',htmlTag:'af-slide',module:'slide-deck',register:'registerSlideDeck',parent:['SlideDeck']},
 ]);
});

test('uses the source title fallback and retains child order and source identities',()=>{
 const heading=element('h4',{},[text('  Details   ')],false);
 const first=element('Slide',{title:literal('  Overview  '),className:literal('p-6')},[text('before'),heading],true);
 const second=element('Slide',{},[element('h2',{},[text('Wrap up')],false)],true);
 const source=element('SlideDeck',{id:literal('deck'),className:literal('slides')},[first,second],true);
 const result=prepareNativeSlideDeck(source);
 assert.deepEqual(result.blockers,[]);
 assert.deepEqual({graphKey:result.node.graphKey,start:result.node.start,end:result.node.end,type:result.node.type,tag:result.node.type==='element'?result.node.tag:undefined,isComponent:result.node.type==='element'?result.node.isComponent:undefined},{graphKey:source.graphKey,start:source.start,end:source.end,type:'element',tag:'SlideDeck',isComponent:true});
 const slides=childElements(result.node);
 assert.deepEqual(slides.map(slide=>slide.graphKey),[first.graphKey,second.graphKey]);
 assert.deepEqual(slides.map(slide=>json(slide,'title')),['Overview','Wrap up']);
 assert.deepEqual(slides[0]!.children.map(child=>child.graphKey),first.children.map(child=>child.graphKey));
 assert.equal(childElements(slides[0]!)[0]?.graphKey,heading.graphKey);
 assert.equal(json(slides[0]!,'className'),'p-6');
 assert.equal(attr(result.node as ElementNode,'index'),undefined);
 assert.equal(attr(result.node as ElementNode,'default-index'),undefined);
});

test('keeps one-slide content outside the native rail and emits the retained source section shape',()=>{
 const slide=element('Slide',{title:literal('  Solo  '),className:literal('px-6')},[element('h6',{},[text('Solo heading')],false)],true);
 const source=element('SlideDeck',{id:literal('one')},[slide],true);
 const result=prepareNativeSlideDeck(source);
 assert.deepEqual(result.blockers,[]);
 assert.equal(result.node.type,'element');if(result.node.type!=='element')return;
 assert.equal(result.node.tag,'div');assert.equal(result.node.isComponent,false);assert.equal(result.node.graphKey,source.graphKey);
 const section=childElements(result.node)[0]!;
 assert.equal(section.tag,'section');assert.equal(section.isComponent,false);assert.equal(section.graphKey,slide.graphKey);
 assert.equal(json(section,'data-mx-slide'),'');assert.equal(json(section,'data-mx-slide-title'),'  Solo  ');
 assert.equal(attr(section,'title'),undefined);assert.equal(json(section,'className'),'px-6');
 assert.equal(childElements(section)[0]?.graphKey,slide.children[0]?.graphKey);
});

test('maps the source aria label and retains selection order without inventing source selection props',()=>{
 const slides=[element('Slide',{},[element('h1',{},[text('First')],false)]),element('Slide',{},[element('h1',{},[text('Second')],false)])];
 const source=element('SlideDeck',{'aria-label':literal('Quarterly slides')},slides,true);
 const result=prepareNativeSlideDeck(source);
 assert.deepEqual(result.blockers,[]);assert.equal(result.node.type,'element');if(result.node.type!=='element')return;
 assert.equal(json(result.node,'label'),'Quarterly slides');assert.equal(attr(result.node,'aria-label'),undefined);
 assert.deepEqual(childElements(result.node).map(slide=>slide.graphKey),slides.map(slide=>slide.graphKey));
 assert.equal(attr(result.node,'index'),undefined);assert.equal(attr(result.node,'default-index'),undefined);
});

test('does not enumerate a Slide nested inside another Slide as a rail slide',()=>{
 const nested=element('Slide',{title:literal('Nested')},[text('nested body')],true);
 const outer=element('Slide',{title:literal('Outer')},[nested],true);
 const other=element('Slide',{title:literal('Other')},[text('other body')],true);
 const result=prepareNativeSlideDeck(element('SlideDeck',{},[outer,other],true));
 const mappedOuter=childElements(result.node)[0]!;
 assert.equal(mappedOuter.tag,'Slide');
 const mappedNested=childElements(mappedOuter)[0]!;
 assert.equal(mappedNested.tag,'section');assert.equal(mappedNested.isComponent,false);assert.equal(mappedNested.graphKey,nested.graphKey);
 assert.equal(json(mappedNested,'data-mx-slide'),'');assert.equal(childElements(result.node).length,2);
});

test('rejects unknown, executable, and target-only selection props without dropping source data',()=>{
 const source=element('SlideDeck',{id:literal('deck'),index:literal(2),onClick:literal('run'),surprise:literal(true)},[
  element('Slide',{title:literal('Only')},[text('content')],true),
 ],true);
 const result=prepareNativeSlideDeck(source);
 assert.deepEqual(result.blockers.map(blocker=>[blocker.code,blocker.attribute]),[
  ['unsupported-slide-deck-prop','index'],['unsupported-slide-deck-prop','onClick'],['unsupported-slide-deck-prop','surprise'],
 ]);
 assert.equal(result.node,source);
});

test('rejects dynamic authored titles rather than changing source rail labels silently',()=>{
 const source=element('SlideDeck',{},[
  element('Slide',{title:{static:false,exprType:'Identifier',source:'$title'}},[element('h1',{},[text('Heading')],false)],true),
  element('Slide',{},[text('Second')],true),
 ],true);
 const result=prepareNativeSlideDeck(source);
 assert.ok(result.blockers.some(blocker=>blocker.code==='dynamic-slide-title'&&blocker.attribute==='title'));
 assert.equal(result.node,source);
});
