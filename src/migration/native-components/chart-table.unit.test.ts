import test from 'node:test';import assert from 'node:assert/strict';import {nativeChartCellText,nativeChartVisibleRows} from './chart-table.ts';
test('table cells preserve retained runtime-locale numeric formatting and literal fallback semantics',()=>{for(const value of [1.2345,-1.235,0,NaN,Infinity,-Infinity])assert.equal(nativeChartCellText(value),new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value));for(const [value,expected]of [[null,''],[undefined,''],['001','001'],[false,'false'],[{a:1},'[object Object]']] as const)assert.equal(nativeChartCellText(value),expected);});
test('original table cap preserves row order and objects without changing data bound to the query',()=>{const rows=Array.from({length:250},(_,id)=>({id})),visible=nativeChartVisibleRows(rows);assert.equal(visible.length,200);assert.equal(visible[199],rows[199]);assert.equal(rows.length,250);assert.notEqual(visible,rows);});

test('Chart table is plain source markup with ordered literal cells, numeric alignment and no sortable controls',async()=>{
 const module=await import('./chart-table.ts') as unknown as {renderNativeChartPlainTable:(doc:{createElement(tag:string):unknown},data:unknown)=>Node};
 class Node {children:Node[]=[];className='';textContent='';attrs=new Map<string,string>();readonly tag:string;constructor(tag:string){this.tag=tag;}append(...nodes:Node[]){this.children.push(...nodes);}setAttribute(k:string,v:string){this.attrs.set(k,v);}}
 const input={columns:[{name:'label',type:'string'},{name:'amount',type:'number'},{name:'flag',type:'boolean'}],rows:[{label:'<b>literal</b>',amount:12.345,flag:false}]},before=JSON.stringify(input);
 const root=module.renderNativeChartPlainTable({createElement:tag=>new Node(tag)},input);
 assert.equal(root.className,'flex h-full w-full flex-col');const scroll=root.children[0]!;assert.equal(scroll.className,'min-h-0 w-full flex-1 overflow-auto p-2');assert.equal(scroll.attrs.get('aria-label'),'Data table');
 const table=scroll.children[0]!;assert.equal(table.tag,'table');assert.equal(table.className,'w-full text-sm');const [head,body]=table.children;assert.equal(head!.children[0]!.className,'border-b border-border text-left text-muted-foreground');assert.deepEqual(head!.children[0]!.children.map(x=>[x.tag,x.textContent,x.className]),input.columns.map(x=>['th',x.name,'px-2 py-1.5 font-medium']));
 assert.deepEqual(body!.children[0]!.children.map(x=>[x.textContent,x.className]),[['<b>literal</b>','px-2 py-1.5'],[new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(12.345),'px-2 py-1.5 text-right tabular-nums'],['false','px-2 py-1.5']]);assert.equal(JSON.stringify(input),before);
 const nodes=(n:Node):Node[]=>[n,...n.children.flatMap(nodes)];assert.equal(nodes(root).some(n=>n.attrs.has('tabindex')||n.attrs.has('aria-sort')||n.tag==='af-data-table'),false);
 const capped=module.renderNativeChartPlainTable({createElement:tag=>new Node(tag)},{columns:input.columns,rows:Array.from({length:201},(_,i)=>({label:String(i),amount:i,flag:true}))});assert.equal(capped.children[0]!.children[0]!.children[1]!.children.length,200);
});

test('mounted table Chart updates ordered plain rows without loading sorting or drawing engines and disposes owned DOM',async()=>{
 const {mountNativeChart}=await import('./chart-runtime.ts');
 class Element {
  children:Element[]=[];parentElement:Element|null=null;attrs=new Map<string,string>();style={cssText:'',display:'',flexDirection:'',width:'',height:''};className='';textContent='';clientWidth=400;clientHeight=120;isConnected=true;
  append(...nodes:Element[]){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}replaceChildren(...nodes:Element[]){for(const n of [...this.children])n.remove();this.append(...nodes);}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}
  setAttribute(k:string,v:string){this.attrs.set(k,v);}getAttribute(k:string){return this.attrs.get(k)??null;}
 }
 const previous=Object.fromEntries(['document','window','ResizeObserver','MutationObserver'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const doc={createElement:()=>new Element(),documentElement:new Element()},observer=class{observe(){}disconnect(){}};
 for(const[k,v]of Object.entries({document:doc,window:{addEventListener(){},removeEventListener(){}},ResizeObserver:observer,MutationObserver:observer}))Object.defineProperty(globalThis,k,{configurable:true,value:v});

 try {
  const el=new Element(),mapping={sourceNode:'chart',nodeSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),analysisSha256:'c'.repeat(64),kind:'table' as const,data:{kind:'table' as const,name:'rows'},props:{viz:{kind:'table'}},height:320,inGridItem:false,sha256:'d'.repeat(64)};let tables=0,draws=0;
  const dispose=mountNativeChart(el as unknown as HTMLElement,mapping,{numberFormat:()=>String,async draw(){draws++;return{finalize(){}};},async table(){tables++;}}),bound=el as unknown as {data:unknown};
  const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
  bound.data={columns:[{name:'value',type:'number'}],rows:[{value:42}]};await settle();
  const body=()=>el.children[0]!.children[0]!.children[0]!.children[0]!.children[0]!.children[1]!;
  assert.equal(body().children[0]!.children[0]!.textContent,'42');assert.equal(el.getAttribute('data-native-chart-state'),'ready');
  bound.data={columns:[{name:'value',type:'number'}],rows:[{value:0},{value:-12.345}]};await settle();assert.equal(body().children.length,2);assert.equal(body().children[0]!.children[0]!.textContent,'0');assert.equal(draws,0);assert.equal(tables,0);
  bound.data=null;assert.equal(el.getAttribute('data-native-chart-state'),'pending');assert.equal(el.children[0]!.children.length,0);dispose();assert.equal(el.children.length,0);assert.equal(Object.hasOwn(el,'data'),false);
 }finally{for(const[k,d]of Object.entries(previous)){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}}
});
