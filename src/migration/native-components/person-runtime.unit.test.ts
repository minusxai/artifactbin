import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativePersonProjection} from './person-runtime.ts';
test('person lookup never manufactures names or accepts other identities',()=>{
 assert.equal(nativePersonProjection('usr_a',[]),null);
 assert.deepEqual(nativePersonProjection('usr_a',[{id:'usr_a',name:'Actual profile',handle:null,image:null}]),{id:'usr_a',name:'Actual profile',handle:null,image:null});
 assert.throws(()=>nativePersonProjection('usr_a',[{id:'usr_b',name:'Other',handle:null,image:null}]));
 assert.throws(()=>nativePersonProjection('usr_a',[{id:'usr_a',name:null,handle:null,image:null}]));
});

import {NATIVE_PERSON_RUNTIME} from './person-runtime.ts';
test('one shared watcher deduplicates hundreds of hosts into bounded lookup batches and fences old responses',async()=>{
 const watches:any[]=[];let current=0,max=0;
 const client={watchQuery(options:any){return {subscribe(next:any){current++;max=Math.max(max,current);const watch={options,next,stopped:false};watches.push(watch);return {unsubscribe(){if(!watch.stopped){current--;watch.stopped=true;}}};}};}};
 const at=(record:any,path:string[])=>path.reduce((value,key)=>value?.[key]??null,record);
 const install=Function('return ('+NATIVE_PERSON_RUNTIME+')')();
 const render=install(client,(source:string)=>source,at,{people:{namespace:'selected'}},nativePersonProjection);
 const scope=()=>({active:true,cleanups:new Set<()=>void>()}),scopes=Array.from({length:250},scope),hosts=Array.from({length:250},()=>({person:null,loading:false,error:null,identityState:'unknown'} as any));
 hosts.forEach((host,index)=>render(host,'usr_'+String(index%125).padStart(3,'0'),scopes[index]));await Promise.resolve();
 assert.equal(watches.length,1);assert.equal(max,1);assert.deepEqual(Object.values(watches[0].options.variables).map((value:any)=>value.length),[100,25]);assert.match(watches[0].options.query,/batch0:people.*batch1:people/);
 const response=(watch:any)=>({data:{selected:Object.fromEntries(Object.values(watch.options.variables).map((ids:any,index)=>['batch'+index,ids.map((id:string)=>({id,name:'Actual '+id,handle:null,image:null}))]))}});
 watches[0].next(response(watches[0]));assert.equal(hosts[0].person.name,'Actual usr_000');assert.equal(hosts[125].person.name,'Actual usr_000');
 const extra={} as any,extraScope=scope();render(extra,'usr_000',extraScope);await Promise.resolve();assert.equal(watches.length,1);assert.equal(extra.person.name,'Actual usr_000');
 render(hosts[0],'usr_new',scopes[0]);await Promise.resolve();assert.equal(max,1);assert.equal(watches[0].stopped,true);assert.equal(hosts[0].person,null);
 watches[0].next(response(watches[0]));assert.equal(hosts[0].person,null);
 watches[1].next({errors:[{message:'revoked'}]});assert.equal(hosts[0].error,'Person unavailable');assert.equal(extra.person,null);
 for(const item of [...scopes,extraScope]){item.active=false;for(const cleanup of [...item.cleanups])cleanup();}await Promise.resolve();assert.equal(current,0);assert.equal(hosts[0].person,null);
});
