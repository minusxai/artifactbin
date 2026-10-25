import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_OBSERVER_RUNTIME} from './observer-runtime.ts';
import type {NativeObserverSnapshot} from './observer-contracts.ts';
test('read-only observer effects follow shared rows/loading/errors and dispose effects and exact listeners',()=>{
 let next:(snapshot:NativeObserverSnapshot)=>void=()=>{},stopped=false;
 const listeners=new Map<string,()=>void>();
 const element={addEventListener:(event:string,handler:()=>void)=>listeners.set(event,handler),removeEventListener:(event:string)=>listeners.delete(event)};
 const errors:string[]=[],install=Function('return ('+NATIVE_OBSERVER_RUNTIME+')')();
 const api=install((listener:any)=>{next=listener;listener({active:true,values:{days:7},queries:{results:{rows:null,loading:true,error:null}}});return()=>{stopped=true;}},{values:['days'],queries:['results']},(error:string)=>errors.push(error));
 const [days]=api.signal('$days'),resource=api.query('$results'),seen:any[]=[];
 api.createEffect(()=>seen.push([days(),resource(),resource.loading(),resource.error()]));
 assert.deepEqual(seen,[[7,[],true,null]]);
 next({active:true,values:{days:1},queries:{results:{rows:[{count:2}],loading:false,error:null}}});assert.deepEqual(seen.at(-1),[1,[{count:2}],false,null]);
 next({active:true,values:{days:1},queries:{results:{rows:null,loading:false,error:'Query unavailable'}}});assert.deepEqual(seen.at(-1),[1,[],false,'Query unavailable']);
 let clicks=0;api.listen(element,'click',()=>{clicks++;});assert.equal(listeners.size,1);listeners.get('click')!();assert.equal(clicks,1);
 next({active:false,values:{},queries:{}});assert.equal(stopped,true);assert.equal(listeners.size,0);const count=seen.length;next({active:true,values:{days:2},queries:{}});assert.equal(seen.length,count);assert.deepEqual(errors,[]);
});

test('already disposed binding snapshots immediately release the observer subscription',()=>{let stopped=false;const api=Function('return ('+NATIVE_OBSERVER_RUNTIME+')')()((listener:any)=>{listener({active:false,values:{},queries:{}});return()=>{stopped=true;}},{values:[],queries:[]},()=>{});assert.equal(stopped,true);api.dispose();});

test('capture listeners receive the original event and release exact registration on disposal',()=>{
 const install=Function('return ('+NATIVE_OBSERVER_RUNTIME+')')();
 let current:any,removed:any,delivered:any,stopped=0;
 const host={addEventListener:(...args:any[])=>{current=args;},removeEventListener:(...args:any[])=>{removed=args;}};
 const api=install(()=>()=>{stopped++;},{values:[],queries:[]},assert.fail);
 api.listen(host,'click',(event:any)=>{delivered=event;event.preventDefault();},true);
 const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
 current[1](event);assert.equal(delivered,event);assert.equal(event.defaultPrevented,true);assert.equal(current[2],true);
 const listener=current[1];api.dispose();assert.deepEqual(removed,current);assert.equal(stopped,1);delivered=null;listener(event);assert.equal(delivered,null);api.dispose();assert.equal(stopped,1);
});

test('source-like inline observer follows local selection and rows without leaking a listener after authority loss',async()=>{
 const {adaptNativeObserverSource}=await import('./observer-source.ts');
 const text=`import {query,signal} from 'page';import {createEffect} from 'solid-js';
 const [theme]=signal('$theme');const file=query('$file');const pre=document.querySelector('#code');
 document.addEventListener('click',(event)=>{if(event.defaultPrevented||event.button!==0)return;event.preventDefault();pre.textContent=event.target.textContent;},true);
 createEffect(()=>{const rows=file();if(file.loading()){pre.textContent='Loading';return;}pre.textContent=(theme()||'light')+':'+(rows.length?rows[0].content:'Pick a file');});`;
 const adapted=adaptNativeObserverSource(text,{values:['theme'],queries:['file']},'observer');
 const pre={textContent:''};let next:any;const registrations:any[]=[];const removed:any[]=[];
 const document={querySelector:()=>pre,addEventListener:(...args:any[])=>registrations.push(args),removeEventListener:(...args:any[])=>removed.push(args)};
 const errors:string[]=[];const observer=Function('return ('+NATIVE_OBSERVER_RUNTIME+')')()((listener:any)=>{next=listener;return()=>{};},adapted.plan,(message:string)=>errors.push(message));
 Function('document','observer','const {signal,query,createEffect}=observer;'+adapted.source)(document,observer);
 next({active:true,values:{theme:'dark'},queries:{file:{rows:[],loading:true,error:null}}});assert.equal(pre.textContent,'Loading');
 next({active:true,values:{theme:'dark'},queries:{file:{rows:[{content:'first'}],loading:false,error:null}}});assert.equal(pre.textContent,'dark:first');
 next({active:true,values:{theme:'light'},queries:{file:{rows:[{content:'second'}],loading:false,error:null}}});assert.equal(pre.textContent,'light:second');
 const event={defaultPrevented:false,button:0,target:{textContent:'selected'},preventDefault(){this.defaultPrevented=true;}};registrations[0][1](event);assert.equal(pre.textContent,'selected');assert.equal(event.defaultPrevented,true);
 next({active:false,values:{},queries:{}});assert.deepEqual(removed,registrations);pre.textContent='disposed';registrations[0][1](event);next({active:true,values:{theme:'dark'},queries:{}});assert.equal(pre.textContent,'disposed');assert.deepEqual(errors,[]);
});
