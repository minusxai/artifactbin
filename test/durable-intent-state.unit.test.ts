import test from 'node:test';import assert from 'node:assert/strict';
import {persistentStore} from '../src/browser/core/standalone.ts';
import {createClient,gql,createLocalStore} from '../src/apollo/client.ts';
test('opt-in durable update refuses blocked or memory-only storage before a shared intent can send',async()=>{
 const storage={getItem:()=>null,setItem(){throw Error('quota')}};
 const state=persistentStore({intent:null},'page',storage);
 const client=createClient({backends:[],state});const query=gql`{intent}`;
 await assert.rejects(client.updateQuery({query,requireDurable:true},()=>({intent:{id:'one'}})),/durab/i);
 assert.deepEqual(state.read(),{intent:null});
 await client.updateQuery({query},()=>({intent:{id:'local'}}));assert.deepEqual(state.read(),{intent:{id:'local'}});
 const memory=createClient({backends:[],state:createLocalStore({intent:null})});
 await assert.rejects(memory.updateQuery({query,requireDurable:true},()=>({intent:{id:'one'}})),/durab/i);
});
test('opt-in durable update acknowledges the same canonical document recovered on reload',async()=>{
 const disk=new Map<string,string>();const storage={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value)}};
 const state=persistentStore({intent:null},'page',storage);const client=createClient({backends:[],state});
 await client.updateQuery({query:gql`{intent}`,requireDurable:true},()=>({intent:{id:'same'}}));
 assert.deepEqual(persistentStore({intent:null},'page',storage).read(),{intent:{id:'same'}});
});
