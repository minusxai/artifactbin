import {afterEach,expect,it,vi} from 'vitest';
import type {RunStart,RunnerService} from '@artifactbin/contracts';
import {runInNewContext} from 'node:vm';
import {transform} from 'esbuild';
import {useAppHarness,request} from './harness';
import { createUser, claimToken } from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {POST as publish} from '@/app/api/artifacts/route';
import {PUT as update} from '@/app/api/artifacts/[id]/route';
import {POST as invoke} from '@/app/api/artifacts/[id]/runs/route';
import {setServices} from '@/lib/platform/services';
import {setLambdaProgramResolver} from '@/lib/runner';
import {getArtifactById} from '@/lib/artifacts';
import {prepareClientDocumentPublication} from '@/lib/story/graph/document-update-client';
import {prepareDocumentAuthoringContext} from '@/lib/story/document/document-authoring-context';

useAppHarness();
afterEach(()=>{setLambdaProgramResolver(undefined);setServices({runner:undefined});});
const markup=(n:number)=>`<Helmet><script>{\`export default () => "browser-only";\`}</script><script type="server">{\`export default input => ({version:${n},input});\`}</script></Helmet><p>Handler</p>`;
it('API authenticates callers and pins only the published server handler, ignoring supplied code and identity',async()=>{
 const owner=await createUser({email:'mxmx_test_server_scripts@example.com'}),token=await mintToken('server-script',owner.id);await claimToken(owner.id,token.token);
 const created=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:markup(1)}}));expect(created.status,await created.clone().text()).toBe(201);const {id}=await created.json();
 const admitted:RunStart[]=[];
 const runner:RunnerService={start:vi.fn(async spec=>{admitted.push(spec);return {runId:'test-run'};}),getRun:vi.fn(),events:vi.fn(),cancel:vi.fn()};setServices({runner});
 const route=(opts:Parameters<typeof request>[1])=>invoke(request(`/api/artifacts/${id}/runs`,opts),{params:Promise.resolve({id})});
 expect((await route({method:'POST',json:{requestId:'bad'}})).status).toBe(401);
 const other=await createUser({email:'mxmx_test_server_scripts_other@example.com'});
 expect((await route({method:'POST',actor:{userId:other.id,credential:'session'},json:{requestId:'bad'}})).status).toBe(404);
 expect((await route({method:'POST',actor:{userId:owner.id,credential:'session'},origin:'https://evil.example',json:{requestId:'bad'}})).status).toBe(401);
 expect(admitted).toEqual([]);
 const response=await route({method:'POST',actor:{userId:owner.id,credential:'session'},json:{requestId:'one',input:{ok:true},userId:other.id,program:{source:'malicious'},artifactVersion:'99'}});
 expect(response.status).toBe(202);expect(admitted[0]).toMatchObject({userId:owner.id,artifactId:id,artifactVersion:'1',requestId:`artifact:${id}:one`,input:{ok:true}});
 expect(admitted[0]!.program.source).not.toContain('browser-only');
 const row=(await getArtifactById(id))!;if(row.document?.kind!=='graph')throw Error('Missing graph');
 const document_update=await prepareClientDocumentPublication({...row,document:row.document},{source:markup(2),whole:true},async source=>{
  const result=await prepareDocumentAuthoringContext({userId:owner.id,tokenId:token.id},id,{source});if(!result.ok)throw Error(await result.text());
 });
 const replaced=await update(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{edit_id:row.edit_id,document_update}}),{params:Promise.resolve({id})});expect(replaced.status,await replaced.clone().text()).toBe(200);
 expect(admitted[0]!.document!.source).toContain('version:1');expect(admitted[0]!.document!.source).not.toContain('version:2');
 const output=await transform(admitted[0]!.program.source,{format:'iife',globalName:'Handler'});
 const run=runInNewContext(output.code+';Handler.default',{});
 expect(await run({ok:true},{artifactbin:{call:async()=>({tables:{},errors:{}})}})).toEqual({version:1,input:{ok:true}});
});
it('rejects invalid server handlers during publication and refuses to invoke a document whose Helmet has only a bare browser script',async()=>{
 const owner=await createUser({email:'mxmx_test_server_script_validation@example.com'}),token=await mintToken('server-script',owner.id);await claimToken(owner.id,token.token);
 for(const script of ['export const notAHandler = 1;', 'export default () => import("https://evil.example/module.js");', 'import fs from "node:fs"; export default () => fs;']){
  const response=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:`<Helmet><script type="server">{${JSON.stringify(script)}}</script></Helmet><p>Invalid</p>`}}));
  expect(response.status,await response.clone().text()).toBe(400);expect(await response.json()).toMatchObject({error:'invalid_server_script'});
 }
 const response=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<Helmet><script>{`export default () => 42;`}</script></Helmet><p>Legacy</p>'}}));expect(response.status).toBe(201);const {id}=await response.json();
 const start=vi.fn(async()=>({runId:'legacy'}));setServices({runner:{start,getRun:vi.fn(),events:vi.fn(),cancel:vi.fn()}});
 expect((await invoke(request(`/api/artifacts/${id}/runs`,{method:'POST',actor:{userId:owner.id,credential:'session'},json:{requestId:'legacy'}}),{params:Promise.resolve({id})})).status).toBe(400);expect(start).not.toHaveBeenCalled();
});

it('never treats an explicitly browser-only default export as a server handler',async()=>{
 const owner=await createUser({email:'mxmx_test_browser_only_script@example.com'}),token=await mintToken('browser-only',owner.id);await claimToken(owner.id,token.token);
 const response=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<Helmet><script type="module">{`export default () => 42;`}</script></Helmet><p>Browser only</p>'}}));expect(response.status).toBe(201);const {id}=await response.json();
 const start=vi.fn(async()=>({runId:'should-not-start'}));setServices({runner:{start,getRun:vi.fn(),events:vi.fn(),cancel:vi.fn()}});
 expect((await invoke(request(`/api/artifacts/${id}/runs`,{method:'POST',actor:{userId:owner.id,credential:'session'},json:{requestId:'browser'}}),{params:Promise.resolve({id})})).status).toBe(400);expect(start).not.toHaveBeenCalled();
});
