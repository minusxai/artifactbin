import {renderNativeChartPlainTable} from './chart-table.ts';
import {nativeChartSingleValue} from './chart-single-value.ts';
import type {NativeChartNumberFormatter} from './chart-contracts.ts';
import {nativeChartLifecycle} from './chart-lifecycle.ts';
import type {NativeChartMapping} from './chart-contracts.ts';
export interface NativeChartTable {rows:Record<string,unknown>[];columns:{name:string;type:string}[];truncated?:boolean;totalRows?:number}
/** A connected, exact-size, hidden staging surface; runtime owns its commit/removal. */
export type NativeChartDrawSurface=HTMLElement;
export interface NativeChartRuntimePorts {
 draw(element:NativeChartDrawSurface,mapping:NativeChartMapping,table:NativeChartTable,size:{width:number;height:number},mode:'light'|'dark',themeElement:HTMLElement):Promise<{finalize():void}>;
 table():Promise<void>;
 numberFormat:NativeChartNumberFormatter;
}
/** Ordinary author-owned DOM adapter. Engines and the native table are separate
 * imported modules; retained recipes are never executed as JSX or page scripts. */
export function mountNativeChart(el:HTMLElement,mapping:NativeChartMapping,ports:NativeChartRuntimePorts):()=>void {
 const body=document.createElement('div'),status=document.createElement('p'),sample=document.createElement('div');
 body.style.cssText='position:relative;flex:1;min-height:0;width:100%;overflow:hidden';status.setAttribute('role','status');status.setAttribute('aria-label','Chart status');sample.setAttribute('aria-label','Sample notice');sample.className='shrink-0 border-t border-border px-3 py-1 font-mono text-[11px] text-muted-foreground';
 const owned:HTMLElement[]=[body,status,sample];
 if(mapping.kind!=='table'&&mapping.kind!=='single_value'&&typeof mapping.props.title==='string'&&mapping.props.title){const title=document.createElement('div');title.className='border-b border-border px-3 py-2 font-mono text-sm font-medium';title.textContent=mapping.props.title;owned.unshift(title);}
 el.append(...owned);el.setAttribute('aria-label','Question embed');el.style.display='flex';el.style.flexDirection='column';el.style.width='100%';el.style.height=mapping.inGridItem?'100%':mapping.height+'px';
 let table:NativeChartTable|undefined,disposed=false,lastSize='';
 const pendingSurfaces=new Set<HTMLElement>();
 const clearPending=()=>{for(const surface of pendingSurfaces)surface.remove();pendingSurfaces.clear();};
 const mode=(): 'light'|'dark'=>el.closest('.dark')?'dark':'light';
 const size=()=>({width:Math.max(80,Math.floor(body.clientWidth||el.clientWidth)),height:Math.max(60,Math.floor(body.clientHeight||el.clientHeight))});
 const model=nativeChartLifecycle<{element:HTMLElement;finalize():void}>(view=>{if(pendingSurfaces.delete(view.element)){view.element.style.position='';view.element.style.inset='';view.element.style.visibility='';view.element.style.pointerEvents='';}body.replaceChildren(view.element);status.textContent='';if(mapping.kind==='single_value')status.style.display='none';el.setAttribute('aria-busy','false');el.setAttribute('data-native-chart-state','ready');},cause=>{status.style.display='';status.textContent=cause instanceof Error?cause.message:String(cause);el.setAttribute('aria-busy','false');el.setAttribute('data-native-chart-state','error');});
 const render=()=>{
  if(disposed||!table)return;const current=table;
  sample.style.display=current.truncated?'':'none';sample.textContent=current.truncated?`showing the first ${new Intl.NumberFormat().format(current.rows.length)} of ${new Intl.NumberFormat().format(current.totalRows??current.rows.length)} rows`:'';
  if(mapping.kind!=='table'&&mapping.kind!=='single_value'){status.style.display='none';status.textContent='';}
  const measurement=size();lastSize=JSON.stringify(measurement);el.setAttribute('aria-busy','true');el.setAttribute('data-native-chart-state','pending');
  void model.render(async()=>{
   const element=document.createElement('div');element.style.cssText='height:100%;width:100%';let view:{finalize():void};
   if(mapping.kind==='single_value'){
    element.className='flex h-full w-full flex-col items-start justify-center gap-1 p-4';element.setAttribute('aria-label','Single value');
    const single=nativeChartSingleValue(current,mapping.props,ports.numberFormat);
    if(single.label){const label=document.createElement('div');label.className='text-sm text-muted-foreground';label.textContent=String(single.label);element.append(label);}
    const value=document.createElement('div');value.className='text-4xl font-semibold tracking-tight tabular-nums';value.textContent=single.text;element.append(value,sample);view={finalize(){}};
   }else if(mapping.kind==='table'){
    const plain=renderNativeChartPlainTable(document,current);element.append(plain);view={finalize(){plain.remove();}};
   }else {
    element.style.position='absolute';element.style.inset='0';element.style.visibility='hidden';element.style.pointerEvents='none';pendingSurfaces.add(element);body.append(element);
    try{view=await ports.draw(element,mapping,current,measurement,mode(),el);}catch(error){pendingSurfaces.delete(element);element.remove();throw error;}
   }
   return {element,finalize(){pendingSurfaces.delete(element);view.finalize();element.remove();}};
  });
 };
 const previous=Object.getOwnPropertyDescriptor(el,'data');if(previous&&!previous.configurable)throw Error('Chart data property already owned');
 Object.defineProperty(el,'data',{configurable:true,get:()=>table,set(value:NativeChartTable|null|undefined){if(disposed)return;if(value!==null&&value!==undefined&&(!Array.isArray(value.rows)||!Array.isArray(value.columns)))throw Error('Chart requires decoded table data');table=value??undefined;if(!table){status.style.display='';model.clear();clearPending();body.replaceChildren();sample.textContent='';status.textContent='data unavailable — waiting for declared table';el.setAttribute('aria-busy','true');el.setAttribute('data-native-chart-state','pending');}else render();}});
 const resize=new ResizeObserver(()=>{if(!disposed&&table&&JSON.stringify(size())!==lastSize)render();});resize.observe(el);
 const themes=new MutationObserver(()=>render());for(let ancestor:Element|null=el.parentElement;ancestor;ancestor=ancestor.parentElement)themes.observe(ancestor,{attributes:true,attributeFilter:['class','data-theme','data-af-dark','data-af-design-system']});
 const removal=new MutationObserver(()=>{if(!el.isConnected)dispose();});removal.observe(document.documentElement,{childList:true,subtree:true});
 function dispose(){if(disposed)return;disposed=true;resize.disconnect();themes.disconnect();removal.disconnect();window.removeEventListener('pagehide',dispose);model.dispose();clearPending();owned.forEach(node=>node.remove());if(previous)Object.defineProperty(el,'data',previous);else delete (el as HTMLElement&{data?:unknown}).data;}
 window.addEventListener('pagehide',dispose,{once:true});if(mapping.data.kind==='ref'){body.textContent='data unavailable — bind a declared table with data="$name"';body.setAttribute('aria-label','Chart placeholder');body.className='flex h-full w-full items-center justify-center p-4 text-sm text-muted-foreground';status.textContent='';if(mapping.kind==='single_value')status.style.display='none';el.setAttribute('aria-busy','false');el.setAttribute('data-native-chart-state','unavailable');}else {status.textContent='data unavailable — waiting for declared table';el.setAttribute('aria-busy','true');}return dispose;
}
