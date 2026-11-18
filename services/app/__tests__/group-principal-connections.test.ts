/**
 * WHO A DATABASE SEES WHEN AN AGENT SIGNED IN AS A GROUP READS (contracts connectors `ConnectorViewer`): on the
 * install's default connection and on a dataset-owned connection, no person, exactly its group, and its level; a
 * person's level is empty.
 */
import {afterAll,beforeAll} from 'vitest';
import {startPgliteWire,type PgliteWire} from '@artifactbin/test-support/pglite-wire';
import {closeDefaultConnection} from '@/lib/connections';
import {closeLiveDatasetConnections} from '@/lib/live-datasets';
import {overrideConfig} from '@/lib/platform/config';
import {SECRET} from './group-principal-fixture';
import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {composed,origin,useGroupPrincipalHost,world} from './group-principal-fixture';
useAppHarness();
useGroupPrincipalHost();
let wire:PgliteWire;
beforeAll(async()=>{wire=await startPgliteWire(`create view public.who as select current_setting('app.viewer_id', true) as id, current_setting('app.viewer_email', true) as email,
  current_setting('app.viewer_groups', true) as groups, current_setting('app.viewer_group_role', true) as level`);});
// Both kinds of connection close their sessions before the database does, so the file ends at once.
afterAll(async()=>{await closeDefaultConnection();await closeLiveDatasetConnections();await wire?.close();});

it('the default connection names a group agent with no person, exactly its group, and its level; a person with an empty level',async()=>{
 const host=await composed(),{eve,team}=await world(host,false);
 overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{DATASETS__DEFAULT_CONNECTION:JSON.stringify({connector:'postgres',host:'127.0.0.1',port:wire.port,database:'postgres',user:'postgres',password:'x',tls:'disable'}),DATASETS__ALLOW_PRIVATE_NETWORK:'1'});
 const who=async(token:string)=>{const r=await host.call('POST','/api/default-connection/sql',token,{sql:'select id, email, groups, level from public.who'});expect(r.status,JSON.stringify(r.body)).toBe(200);return (r.body!.rows as unknown[])[0];};
 for(const role of ['member','editor'] as const)expect(await who((await eve.asGroup(team.id,role)).token)).toEqual({id:'',email:'',groups:JSON.stringify([team.id]),level:role});
 expect(await who(eve.token)).toEqual({id:eve.userId,email:'mxmx_test_ga_eve@example.test',groups:JSON.stringify([team.id]),level:''});
});

it('says plainly, where database row policies are written from, that the empty id is no match and the level is reserved',async()=>{
 const {readFile}=await import('node:fs/promises');
 const env=(await readFile(new URL('../../../.env.example',import.meta.url),'utf8')).replace(/\n# /g,' ');
 expect(env).toContain('A row policy comparing a column to app.viewer_id must never treat the empty id as a match: decide a group\'s agent by app.viewer_groups and app.viewer_group_role.');
 const contract=(await readFile(new URL('../../contracts/src/connectors.ts',import.meta.url),'utf8')).replace(/\n \* /g,' ');
 expect(contract).toContain('A policy comparing a column to `viewer_id` must never treat the empty id as a match');
 expect(contract).toContain('a page that sends a parameter of that name is refused (400 `validation_failed`)');
});

it('a dataset-owned connection binds the same reader values: no person, exactly its group, and its level',async()=>{
 const host=await composed(),{eve,team}=await world(host,false);
 overrideConfig({internalServiceSecret:SECRET,publicBaseUrl:origin},{DATASETS__ALLOW_PRIVATE_NETWORK:'1'});
 const live=await host.call('POST','/api/artifacts',eve.token,{title:'Shop',destination:{type:'group',id:team.id},visibility:'private',
  connection:{connector:'postgres',host:'127.0.0.1',port:wire.port,database:'postgres',user:'postgres',password:'x',tls:'disable'}});
 expect(live.status,JSON.stringify(live.body)).toBe(201);
 const pageId=String((await host.call('POST','/api/artifacts',eve.token,{title:'Live page',destination:{type:'group',id:team.id},visibility:'private',
  html:`<html><head><link rel="af-dataset" data-af-name="shop" href="ref:${String(live.body!.id)}"></head><body>Live</body></html>`})).body!.id);
 const agent=await eve.asGroup(team.id,'editor');
 const seen=await host.call('POST',`/api/artifacts/${pageId}/sql`,agent.token,{revision:'1',params:{},sql:'select :viewer_id as id, :viewer_email as email, :viewer_groups as groups, :viewer_group_role as level, id as session_id, level as session_level from shop.public.who'});
 expect(seen.status,JSON.stringify(seen.body)).toBe(200);
 expect(seen.body!.rows).toEqual([{id:null,email:null,groups:JSON.stringify([team.id]),level:'editor',session_id:'',session_level:'editor'}]);
 // The reader may not send them itself.
 expect((await host.call('POST',`/api/artifacts/${pageId}/sql`,agent.token,{revision:'1',params:{viewer_group_role:'member'},sql:'select 1 as one from shop.public.who'})).status).toBe(400);
});
