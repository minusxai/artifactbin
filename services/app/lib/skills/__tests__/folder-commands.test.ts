/** Folder workflows use the ordinary installed commands and durable request journal. */
import {it,expect} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const server='https://example.test';
const env={ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic-folder-fixture'};
it('parses folder collection, folder creation/resume and publish placement',async()=>{
 const {parseCommand}=await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
 expect(parseCommand('publish',['report.html','--create','--parent','FOLD12']).values.parent).toBe('FOLD12');
 expect(parseCommand('groups',['collection','team','--parent','FOLD12','--limit','20','--cursor','opaque']).sub).toBe('collection');
 expect(parseCommand('groups',['folder-create','team','--title','Reports','--request','/tmp/request.json']).sub).toBe('folder-create');
 expect(parseCommand('groups',['folder-create','--resume','/tmp/request.json']).values.resume).toBe('/tmp/request.json');
});
it('lists one exact collection page with an opaque cursor and stable group ID',async()=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');
 const calls:string[]=[],page={items:[{id:'FOLD12',format:'folder',title:'Reports'}],next_cursor:'next+/='};
 const result=await groupsCommand({sub:'collection',positionals:['@team'],values:{parent:'ROOT12',limit:'20',cursor:'opaque+/='}}, {env,fetcher:async(url:any)=>{
  calls.push(String(url));return Response.json(calls.length===1?{group:{id:'grp_team',handle:'team',role:'editor'}}:page);
 }});
 expect(calls).toHaveLength(2);
 const queried=new URL(calls[1]!);expect(queried.pathname).toBe('/api/groups/grp_team/collection');
 expect(Object.fromEntries(queried.searchParams)).toEqual({parent_id:'ROOT12',limit:'20',cursor:'opaque+/='});
 expect(result).toMatchObject(page);
});
it('journals a private group folder before POST and resumes the identical request after reply loss',async()=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'folder-cli-')),journal=path.join(root,'request.json');
 const calls:Array<{body:any;key:string|null}>=[];
 const options={env,fetcher:async(url:any,init:any)=>{
  const route=new URL(String(url)).pathname;
  if(route==='/api/groups/team')return Response.json({group:{id:'grp_team',handle:'team',role:'editor'}});
  expect(route).toBe('/api/artifacts');expect(init.method).toBe('POST');
  const body=JSON.parse(init.body),key=new Headers(init.headers).get('idempotency-key');
  const saved=JSON.parse(await readFile(journal,'utf8'));expect(saved.body).toEqual(body);expect(saved.key).toBe(key);
  calls.push({body,key});if(calls.length===1)throw Error('synthetic lost reply');
  return Response.json({id:'FOLD12',format:'folder',title:'Reports',version:1,parent_id:'ROOT12',url:server+'/a/FOLD12'},{status:201});
 }};
 try{
  await expect(groupsCommand({sub:'folder-create',positionals:['team'],values:{title:'Reports',parent:'ROOT12',request:journal}},options)).rejects.toMatchObject({exit:5});
  const saved=await readFile(journal,'utf8');expect(saved).not.toContain(env.ARTIFACTBIN_TOKEN);
  const result=await groupsCommand({sub:'folder-create',positionals:[],values:{resume:journal}},options);
  expect(result).toMatchObject({id:'FOLD12'});expect(calls).toHaveLength(2);expect(calls[0]).toEqual(calls[1]);
  expect(calls[0]!.body).toEqual({format:'folder',title:'Reports',visibility:'private',destination:{type:'group',id:'grp_team'},parent_id:'ROOT12'});
  expect(calls[0]!.key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('refuses changing a resumed folder request before sending anything',async()=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');let count=0;
 await expect(groupsCommand({sub:'folder-create',positionals:[],values:{resume:'/unused.json',title:'Changed'}},{env,fetcher:async()=>{count++;throw Error('unexpected');}})).rejects.toMatchObject({exit:2});
 expect(count).toBe(0);
});
