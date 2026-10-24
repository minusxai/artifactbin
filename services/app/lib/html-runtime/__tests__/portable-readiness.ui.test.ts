import {afterEach,expect,it,vi} from 'vitest';
import {createClient,createLocalStore,gql} from '../apollo/client';
import type {startPortableSession} from '../portable-session';
const harness=vi.hoisted(()=>({start:vi.fn<typeof startPortableSession>()}));
vi.mock('@afbin/portable',()=>({startPortableSession:harness.start}));
let cleanup:(()=>void)|undefined;
afterEach(()=>{cleanup?.();cleanup=undefined;vi.unstubAllGlobals();vi.resetModules();document.head.innerHTML='';document.documentElement.removeAttribute('data-af-private-preview');localStorage.clear();harness.start.mockReset();});
const identity={platformOrigin:'https://platform.example',artifactId:'p',baseRevision:'1',sourceDigest:'a'.repeat(64)};
it('holds the first read until usable transport, emits configured names once and fences a cancelled waiting read',async()=>{
 document.head.innerHTML=`<script data-af="portable">${JSON.stringify({version:1,source:'',identity})}</script>`;
 vi.stubGlobal('__AF_RUNTIME_CONFIG__',{pageId:'p',revision:'1',backends:['counter','sales'],offline:true});
 let options!:Parameters<typeof startPortableSession>[0];harness.start.mockImplementation(value=>{options=value;value.online(false,undefined,true);return ()=>value.online(false);});
 const {remote,onBackendChange,startPortableDocument,remoteReadOnly}=await import('../browser-reader');expect(remoteReadOnly).toBe(true);
 const events:unknown[]=[];onBackendChange(names=>events.push(names));
 const client=createClient({backends:['counter','sales'],state:createLocalStore(),remote});
 const first=client.query({query:gql`{ counter { count } sales { rows } }`});cleanup=await startPortableDocument();
 const sender=vi.fn(async()=>({data:{counter:{count:9},sales:{rows:3}}}));expect(sender).not.toHaveBeenCalled();options.online(true,sender);options.online(true,sender);
 expect((await first).data).toEqual({counter:{count:9},sales:{rows:3}});expect(sender).toHaveBeenCalledOnce();expect(events).toEqual([['counter','sales']]);
 options.online(false,undefined,true);const cancelled=client.query({query:gql`{ counter { count } }`});options.online(true,sender);options.online(false);expect((await cancelled).errors).toBeDefined();expect(sender).toHaveBeenCalledOnce();
 options.online(false,undefined,true);options.online(true,sender);expect(events).toEqual([['counter','sales'],['counter','sales'],['counter','sales']]);
});
it('returns offline immediately for Stay offline and private preview, with no lazy connection attempt',async()=>{
 for(const privatePreview of [false,true]){
  vi.resetModules();document.head.innerHTML=`<script data-af="portable">${JSON.stringify({version:1,source:'',identity})}</script>`;
  document.documentElement.toggleAttribute('data-af-private-preview',privatePreview);localStorage.setItem(`af:offline:${identity.platformOrigin}:${identity.artifactId}`,'true');
  vi.stubGlobal('__AF_RUNTIME_CONFIG__',{pageId:'p',revision:'1',backends:['counter'],offline:true});const {remote}=await import('../browser-reader');const client=createClient({backends:['counter'],state:createLocalStore(),remote});expect((await client.query({query:gql`{ counter { count } }`})).errors).toBeDefined();expect(harness.start).not.toHaveBeenCalled();
 }
 document.documentElement.removeAttribute('data-af-private-preview');
});
it('keeps private preview datasets immediately queryable without platform connection',async()=>{
 document.documentElement.setAttribute('data-af-private-preview','');vi.stubGlobal('location',{origin:'http://127.0.0.1:3456',protocol:'http:',hostname:'127.0.0.1'});const send=vi.fn(async()=>new Response(JSON.stringify({data:{sales:{count:3}}})));vi.stubGlobal('fetch',send);vi.stubGlobal('__AF_RUNTIME_CONFIG__',{pageId:'local',revision:'local',backends:['sales'],offline:true,localPreview:{endpoint:'/__af_preview/datasets'}});
 const {remote,remoteReadOnly}=await import('../browser-reader');expect(remoteReadOnly).toBe(false);const client=createClient({backends:['sales'],state:createLocalStore(),remote});expect((await client.query({query:gql`{ sales { count } }`})).data).toEqual({sales:{count:3}});expect(send).toHaveBeenCalledOnce();expect(harness.start).not.toHaveBeenCalled();document.documentElement.removeAttribute('data-af-private-preview');
});

it('exports hosted remoteReadOnly false without promising mutation authority',async()=>{
 vi.stubGlobal('__AF_RUNTIME_CONFIG__',{pageId:'p',revision:'1',backends:[],offline:false});const author=await import('../browser-client');expect(author.remoteReadOnly).toBe(false);
});
it('keeps viewer state mutations available while portable remote access is permanently read-only',async()=>{
 vi.stubGlobal('__AF_RUNTIME_CONFIG__',{pageId:'p',revision:'1',backends:[],offline:true,initialState:{filter:'all'}});const author=await import('../browser-client');expect(author.remoteReadOnly).toBe(true);expect(await author.client.updateQuery<{filter:string}>({query:author.gql`{ filter }`},()=>({filter:'mine'}))).toEqual({filter:'mine'});expect((await author.client.query({query:author.gql`{ filter }`})).data).toEqual({filter:'mine'});expect(harness.start).not.toHaveBeenCalled();
});
