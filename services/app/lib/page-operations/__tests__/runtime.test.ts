import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createRunner} from '@artifactbin/runner/local';
import {createBackendCompiler,createBackendInvoker,pageBackendCapability,type PageBackendRecord} from '../backend';
it('executes a compiled immutable backend through the retained isolated runner',async()=>{
 const db=new PGlite();let record:PageBackendRecord;let value:import('@artifactbin/contracts').HtmlJson=null,version=0;
 const store={get:async()=>({value,version}),set:async(_id:string,next:typeof value,expected:number)=>{if(expected!==version)return {ok:false,version};value=next;return {ok:true,version:++version};}};
 const runner=await createRunner({db,capabilities:async(context,operation,args)=>pageBackendCapability(store,context.request,operation,args,async()=>record,async url=>({status:200,url,contentType:'application/json',body:'{"value":"public"}'}),async(backend,name)=>backend.ownerId==='owner1'&&name==='TOKEN'?'server-only-token':Promise.reject(Error('forbidden')))});
 try{
  const source='export const secretBindings=["TOKEN"]; export const typeDefs="type Query { count:Int! remote:String! secretReady:Boolean! } type Mutation { add:Int! @auth(role:EDITOR) }"; export default { secretReady:async(args,p,c)=>(await c.secrets.get("TOKEN")).length>0, remote:async(args,principal,caps)=>{const response=await caps.fetch("https://example.com/data");return (await response.json()).value;}, count: async(args,principal,caps)=>(await caps.store.get()).value?.count??0, add:async(args,principal,caps)=>{const s=await caps.store.get();await caps.store.set({count:(s.value?.count??0)+1},{expected:s.version});return principal.tenant==="page1"?1:0;} };';
  record={...(await createBackendCompiler(runner)(source)),source,backendId:'backend1',pageId:'page1',version:'v1',ownerId:'owner1'};
  expect(record.secretBindings).toEqual(['TOKEN']);expect(record.compiled).not.toContain('server-only-token');
  const invoke=createBackendInvoker(runner,async()=>record);
  const call={namespace:'tasks',fileId:'backend1',version:'v1',operation:'mutation' as const,field:'add',args:{},principal:{tenant:'page1',subject:'viewer1'},signal:new AbortController().signal};
  expect(await invoke(call)).toBe(1);expect(value).toEqual({count:1});expect(version).toBe(1);
  await expect(invoke({...call,operation:'query',field:'add',args:{pageBackendOperation:'mutation'}})).rejects.toThrow();
  expect(version).toBe(1);expect(value).toEqual({count:1});
  expect(await invoke({...call,operation:'query',field:'count'})).toBe(1);
  expect(await invoke({...call,operation:'query',field:'remote'})).toBe('public');
  expect(await invoke({...call,operation:'query',field:'secretReady'})).toBe(true);
 }finally{await runner.close();await db.close();}
},20000);
