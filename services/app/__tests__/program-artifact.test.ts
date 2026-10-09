import {expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import { createUser, claimToken } from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {POST as publish} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace} from '@/app/api/artifacts/[id]/route';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {GET as download} from '@/app/a/[id]/download/route';
import {parseProgramDefinition} from '@artifactbin/contracts';
import {resolveProgramArtifact} from '@/lib/runner/program';
useAppHarness();
const definition={version:1,command:['python','/home/runner/task.py'],env:{REPORT:'daily'}};
it('publishes, reads, exports and replaces validated native program definitions',async()=>{
 const owner=await createUser({email:'mxmx_test_program_owner@example.com'}),token=await mintToken('program',owner.id);await claimToken(owner.id,token.token);
 const response=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{program:definition,title:'Daily report',visibility:'unlisted'}}));expect(response.status,await response.clone().text()).toBe(201);const made=await response.json();
 expect(made.format).toBe('program');const ctx={params:Promise.resolve({id:made.id})};
 const content=await (await read(request(`/api/artifacts/${made.id}`,{token:token.token}),ctx)).json();expect(content.program).toEqual(definition);
 const bytes=await raw(request(`/a/${made.id}/raw`),ctx);expect(bytes.status).toBe(200);expect(bytes.headers.get('content-type')).toContain('application/json');expect(await bytes.json()).toEqual(definition);
 const exported=await download(request(`/a/${made.id}/download`),ctx);expect(exported.status).toBe(200);expect(exported.headers.get('content-disposition')).toContain('.program.json');expect(await exported.json()).toEqual(definition);
 const resolved=await resolveProgramArtifact(made.id,owner.id);
 expect(resolved).toMatchObject({artifactId:made.id,artifactVersion:'1',name:`program:${made.id}`,command:definition.command,env:definition.env,compute:{vcpu:1,memoryMiB:2048},program:{source:'',language:'javascript'}});expect(resolved).not.toHaveProperty('document');
 const next={...definition,command:['node','/home/runner/report.mjs']};const updated=await replace(request(`/api/artifacts/${made.id}`,{method:'PUT',token:token.token,json:{program:JSON.stringify(next),expectedVersion:1,expectedState:content.state}}),ctx);expect(updated.status,await updated.clone().text()).toBe(200);expect(await resolveProgramArtifact(made.id,owner.id)).toMatchObject({artifactVersion:'2',command:next.command});
 const other=await createUser({email:'mxmx_test_program_reader@example.com'});expect(await resolveProgramArtifact(made.id,other.id)).toBeNull();
});
it('rejects malformed, unknown, credential and runtime configuration before creating artifacts',async()=>{
 const token=await mintToken('bad-program');
 for(const program of [{version:2,command:['bash']},{version:1,command:[]},{version:1,command:['bash'],compute:{memoryMiB:3}},...['AF_TOKEN','AF_SERVER','HOME','PATH','NODE_OPTIONS','MODAL_TOKEN_SECRET','ARTIFACTBIN_INPUT','ANTHROPIC_API_KEY','OPENAI_API_KEY','ACCESS_TOKEN','MY_SECRET','databasePassword'].map(key=>({...definition,env:{[key]:'secret'}})),{...definition,env:Object.fromEntries(Array.from({length:128},(_,i)=>[`SETTING_${i}`,'value']))}]){
  const response=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{program}}));expect(response.status).toBe(400);expect((await response.json()).error).toBe('invalid_program');
 }
 expect(()=>parseProgramDefinition('{broken')).toThrow('invalid_program');
 expect(()=>parseProgramDefinition(JSON.stringify({...definition,unknown:true}))).toThrow('invalid_program');
 const env={TOKEN_COUNT:'123',...Object.fromEntries(Array.from({length:126},(_,i)=>[`SETTING_${i}`,'value']))};
 const valid=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{program:{...definition,env}}}));expect(valid.status,await valid.clone().text()).toBe(201);expect((await valid.json()).format).toBe('program');
});
