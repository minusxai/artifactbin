/** Publish the actual installed native examples; resolver execution has separate real-runner coverage. */
import {describe,expect,it,vi} from 'vitest';
import {skillTree} from '@/lib/skills';
import {skillPackageFiles} from '@/lib/skills/package';
import {POST as publish} from '@/app/api/artifacts/route';
import {GET as read} from '@/app/api/artifacts/[id]/route';
import {request,useAppHarness,mintAccountToken} from './harness';
vi.mock('@/lib/page-operations',async original=>({...await original<typeof import('@/lib/page-operations')>(),compilePageBackend:async(source:string)=>{
 const typeDefs=/export const typeDefs\s*=\s*`([\s\S]*?)`/.exec(source)?.[1];if(!typeDefs)throw Error('Missing example schema');return{typeDefs,compiled:source};
}}));
useAppHarness();const files=()=>skillPackageFiles(skillTree(),'http://localhost:3000');
describe('installed native author examples',()=>{
 it('publishes the report as canonical HTML',async()=>{
  const owner=await mintAccountToken('sample-report');const response=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:files()['examples/report.html']}}));expect(response.status,await response.clone().text()).toBe(201);const page=await response.json();expect(page.format).toBe('html');expect(page.html).toContain('data-af-id=');
 });
 it('publishes the CSV separately and binds its real identity in the dashboard',async()=>{
  const owner=await mintAccountToken('sample-dashboard'),kit=files();const dataset=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:kit['examples/repairs.csv']}}));expect(dataset.status).toBe(201);const data=await dataset.json();
  const response=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:kit['examples/csv-dashboard.html']!.replaceAll('DATASET_ID',data.id)}}));expect(response.status,await response.clone().text()).toBe(201);const page=await response.json();expect(page.html).toContain('ref:'+data.id);expect(page.html).not.toContain('DATASET_ID');
 });
 it('publishes the shared app with its declared backend source atomically',async()=>{
  const owner=await mintAccountToken('sample-app'),kit=files();const response=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:kit['examples/shared-app.html'],backendSources:{garden:kit['examples/garden.ts']}}}));expect(response.status,await response.clone().text()).toBe(201);const page=await response.json();
  const head=await read(request(`/api/artifacts/${page.id}`,{token:owner.token}),{params:Promise.resolve({id:page.id})});expect(head.status).toBe(200);expect((await head.json()).html).toContain('data-af-name="garden"');
 });
});
