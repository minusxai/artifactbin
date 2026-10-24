import test from 'node:test';import assert from 'node:assert/strict';import {format} from 'd3-format';
import {nativeChartSingleValue} from './chart-single-value.ts';import type {NativeChartNumberFormatter} from './chart-contracts.ts';
const formatter:NativeChartNumberFormatter=spec=>{try{return format(spec!);}catch{return n=>new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(n);}};
const columns=[{name:'label',type:'string'},{name:'amount',type:'number'},{name:'other',type:'number'}];
test('single value sums finite Number coercions across all rows with exact authored label/affixes/d3 format',()=>{
 const rows=[{amount:1000},{amount:'234.5'},{amount:null},{amount:undefined},{amount:'bad'},{amount:Infinity}],table={columns,rows};
 const props={title:'Fallback',viz:{kind:'single_value',yCols:['amount'],singleValueConfig:{label:'Authored',prefix:'$',suffix:' total',format:',.1f'}}};const before=JSON.stringify(table);
 assert.deepEqual(nativeChartSingleValue(table,props,formatter),{label:'Authored',text:'$1,234.5 total'});assert.equal(JSON.stringify(table),before);
});
test('column selection, runtime locale default, invalid format and empty results follow original single()',()=>{
 const table={columns,rows:[{label:'not numeric',amount:12.345,other:7},{amount:0.01,other:9}]};
 assert.deepEqual(nativeChartSingleValue(table,{title:'Title',viz:{kind:'single_value'}},formatter),{label:'Title',text:new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(12.355)});
 assert.equal(nativeChartSingleValue(table,{viz:{yCols:['other'],singleValueConfig:{format:',0'}}},formatter).text,'16');
 assert.equal(nativeChartSingleValue({...table,rows:[]},{viz:{singleValueConfig:{prefix:'(',suffix:')'}}},formatter).text,'(—)');
 assert.equal(nativeChartSingleValue({...table,rows:[{amount:'bad'}]},{viz:{}},formatter).text,'—');
 assert.equal(nativeChartSingleValue({...table,rows:[{amount:null},{amount:''}]},{viz:{}},formatter).text,'0');
 assert.equal(nativeChartSingleValue({columns:[{name:'first',type:'string'}],rows:[{first:'3'}]},{viz:{singleValueConfig:{label:''}},title:'Not selected'},formatter).label,'');
 assert.equal(nativeChartSingleValue(table,{viz:{yCols:[]}},formatter).text,'—');
});
test('mounted single values render retained chrome and react to data without chart/table engines',async()=>{
 const {mountNativeChart}=await import('./chart-runtime.ts');
 class Element {
  children:Element[]=[];parentElement:Element|null=null;attrs=new Map<string,string>();style={cssText:'',display:'',flexDirection:'',width:'',height:''};className='';textContent='';clientWidth=400;clientHeight=120;isConnected=true;
  append(...nodes:Element[]){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}replaceChildren(...nodes:Element[]){for(const n of [...this.children])n.remove();this.append(...nodes);}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}
  setAttribute(k:string,v:string){this.attrs.set(k,v);}getAttribute(k:string){return this.attrs.get(k)??null;}
 }
 const previous=Object.fromEntries(['document','window','ResizeObserver','MutationObserver'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const doc={createElement:()=>new Element(),documentElement:new Element()},observer=class{observe(){}disconnect(){}};
 for(const[k,v]of Object.entries({document:doc,window:{addEventListener(){},removeEventListener(){}},ResizeObserver:observer,MutationObserver:observer}))Object.defineProperty(globalThis,k,{configurable:true,value:v});
 try{
  const el=new Element(),mapping={sourceNode:'chart',nodeSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),analysisSha256:'c'.repeat(64),kind:'single_value' as const,data:{kind:'table' as const,name:'rows'},props:{title:'Title',viz:{kind:'single_value',singleValueConfig:{label:'Total',format:',.0f'}}},height:120,inGridItem:false,sha256:'d'.repeat(64)};let draws=0,tables=0;
  const dispose=mountNativeChart(el as unknown as HTMLElement,mapping,{numberFormat:formatter,async draw(){draws++;return{finalize(){}};},async table(){tables++;}});
  const bound=el as unknown as {data:unknown};bound.data={columns,rows:[{amount:1000},{amount:234}]};await new Promise(resolve=>setTimeout(resolve,0));
  const single=el.children[0]!.children[0]!;assert.equal(single.getAttribute('aria-label'),'Single value');assert.equal(single.className,'flex h-full w-full flex-col items-start justify-center gap-1 p-4');assert.equal(single.children[0]!.textContent,'Total');assert.equal(single.children[1]!.textContent,'1,234');assert.equal(el.children.length,2);assert.equal(el.children[1]!.style.display,'none');assert.equal(el.style.height,'120px');assert.equal(el.getAttribute('data-native-chart-state'),'ready');
  bound.data={columns,rows:[]};await new Promise(resolve=>setTimeout(resolve,0));assert.equal(el.children[0]!.children[0]!.children[1]!.textContent,'—');assert.equal(draws,0);assert.equal(tables,0);dispose();assert.equal(el.children.length,0);assert.equal(Object.hasOwn(el,'data'),false);
 }finally{for(const[k,d]of Object.entries(previous)){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}}
});
