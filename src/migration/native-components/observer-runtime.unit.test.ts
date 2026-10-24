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
