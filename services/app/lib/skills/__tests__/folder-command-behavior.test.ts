/** Placement is part of the prepared write; folder replay accepts only its dedicated shape. */
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {archiveFor} from '..';
import {publishCommand} from '../../../skills/artifactbin/scripts/toolbox-publish.mjs';
import {groupsCommand} from '../../../skills/artifactbin/scripts/groups.mjs';
import {journalIntent} from '../../../skills/artifactbin/scripts/toolbox-journal.mjs';
const server='https://example.test';
const env={ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic-fixture'};
const html='<!doctype html><html><head><title>Notes</title></head><body><h1>Notes</h1><p>Weekly notes for the shared collection.</p></body></html>';
const run=promisify(execFile);
async function workspace(work:(root:string)=>Promise<void>){
 const root=await mkdtemp(path.join(tmpdir(),'folder-behavior-'));
 try{await work(root);}finally{await rm(root,{recursive:true,force:true});}
}
it.each([['page.html',html],['rows.csv','name,count\nentry,2'],['note.txt','A plain note']])(
 'transmits and dry-runs folder placement for %s',async(name,content)=>workspace(async root=>{
 const project=path.join(root,'project');await mkdir(project);const file=path.join(project,name);
 await writeFile(file,content);const sent:any[]=[];
 const options={env:{...env,ARTIFACTBIN_HOME:path.join(root,'home')},log:()=>{},
  fetcher:async(_url:any,init:any)=>{const body=JSON.parse(init.body);sent.push(body);
   return Response.json({id:'PAGE12',version:1,format:'html',state:'a'.repeat(64),
    url:server+'/a/PAGE12',...(body.html?{html:body.html}:{})});}};
 const values={create:true,parent:server+'/a/FOLD12'};
 expect(await publishCommand({positionals:[file],values:{...values,'dry-run':true}},options))
  .toMatchObject({dryRun:true,parent_id:'FOLD12',method:'POST'});
 expect(sent).toHaveLength(0);
 const result=await publishCommand({positionals:[file],values},options);
 expect(sent).toHaveLength(1);expect(sent[0].parent_id).toBe('FOLD12');
 const saved=JSON.parse(await readFile(result.journal,'utf8'));
 expect(saved.body.parent_id).toBe('FOLD12');
}));
it('refuses invalid placement, update placement and connections before HTTP',async()=>workspace(async root=>{
 const file=path.join(root,'page.html');await writeFile(file,html);let calls=0;
 const options={env,fetcher:async()=>{calls++;throw Error('unexpected');}};
 for(const values of [{create:true,parent:'bad'},
  {create:true,parent:'https://other.test/a/FOLD12'},
  {artifact:'PAGE12',parent:'FOLD12'},{type:'connection',parent:'FOLD12'}]){
  await expect(publishCommand({positionals:[file],values},options)).rejects.toMatchObject({exit:2});
 }
 const {stampSource}=await import('../../../skills/artifactbin/scripts/toolbox-source.mjs');
 // A genuine publish marker also selects an update without --artifact.
 await writeFile(file,stampSource(html,{server,id:'PAGE12',version:1,state:'a'.repeat(64),
  sha256:'a'.repeat(64),entryPath:'page.html'}));
 await expect(publishCommand({positionals:[file],values:{parent:'FOLD12'}},options))
  .rejects.toMatchObject({code:'parent_not_for_update'});
 expect(calls).toBe(0);
}));
it('denies folder viewers and unsafe references without POST',async()=>{
 const calls:string[]=[];const options={env,fetcher:async(url:any)=>{calls.push(String(url));
  return Response.json({group:{id:'grp_team',handle:'team',role:'member'}});}};
 await expect(groupsCommand({sub:'folder-create',positionals:['team'],values:{title:'Notes'}},options))
  .rejects.toMatchObject({exit:3});
 for(const parent of ['bad','https://other.test/a/FOLD12'])await expect(groupsCommand({
  sub:'folder-create',positionals:['team'],values:{title:'Notes',parent}},options))
  .rejects.toMatchObject({exit:2});
 for(const title of ['', ' '.repeat(2),'x'.repeat(201)])await expect(groupsCommand({
  sub:'folder-create',positionals:['team'],values:{title}},options)).rejects.toMatchObject({exit:2});
 expect(calls).toHaveLength(1);
});
it('rejects malformed, foreign and tampered folder journals without HTTP',async()=>workspace(async root=>{
 let calls=0;const options={env,fetcher:async()=>{calls++;throw Error('unexpected');}};
 const body={format:'folder',title:'Notes',visibility:'private',destination:{type:'group',id:'grp_team'}};
 const intent=journalIntent({server,method:'POST',path:'/api/artifacts',body,operation:'folder-create'});
 const file=path.join(root,'request.json');
 for(const changed of [{server:'https://other.test'},{method:'PUT'},{path:'/api/groups'},
  {operation:'publish'},{body:{...body,html:'<p>injected</p>'}},
  {body:{...body,parent_id:'https://other.test/a/FOLD12'}},
  {body:{...body,visibility:'public'}},{body:{...body,destination:{type:'personal'}}},
  {body:[]},{source:{file:'/tmp/page.html'}},{key:'bad'}]){
  await writeFile(file,JSON.stringify({...intent,...changed}));
  await expect(groupsCommand({sub:'folder-create',positionals:[],values:{resume:file}},options))
   .rejects.toMatchObject({exit:2});
 }
 await writeFile(file,'{');
 await expect(groupsCommand({sub:'folder-create',positionals:[],values:{resume:file}},options))
  .rejects.toMatchObject({exit:2});expect(calls).toBe(0);
}));
it('returns canonical folder fields, records receipt and reports committed receipt failure',async()=>workspace(async root=>{
 const file=path.join(root,'request.json');let posts=0;
 const options={env,fetcher:async(url:any)=>{
  if(String(url).endsWith('/api/groups/team'))return Response.json({group:{id:'grp_team',handle:'team',role:'admin'}});
  posts++;return Response.json({id:'FOLD12',title:'Canonical Notes',format:'folder',parent_id:'ROOT12',url:server+'/a/FOLD12'});
 }};
 const parsed={sub:'folder-create',positionals:['team'],values:{title:'Notes',parent:'ROOT12',request:file}};
 expect(await groupsCommand(parsed,options)).toEqual({id:'FOLD12',title:'Canonical Notes',format:'folder',
  parent_id:'ROOT12',url:server+'/a/FOLD12',journal:expect.any(String)});
 expect(JSON.parse(await readFile(file+'.receipt.json','utf8')).receipt.id).toBe('FOLD12');
 await rm(file+'.receipt.json');await mkdir(file+'.receipt.json');
 await expect(groupsCommand({sub:'folder-create',positionals:[],values:{resume:file}},options))
  .rejects.toMatchObject({code:'receipt_save_failed',details:{committed:true,id:'FOLD12'}});
 expect(posts).toBe(2);
}));
it('keeps root collection one page and does not imply publication access',async()=>{
 const calls:string[]=[];const page={items:[],next_cursor:'opaque'};
 expect(await groupsCommand({sub:'collection',positionals:['team'],values:{}},{env,
  fetcher:async(url:any)=>{calls.push(String(url));return Response.json(calls.length===1?
   {group:{id:'grp_team',handle:'team',role:'member'}}:page);}})).toEqual(page);
 expect(calls).toEqual([server+'/api/groups/team',server+'/api/groups/grp_team/collection']);
});
it('fresh candidate archive executes the real folder-create parser and helper',async()=>workspace(async root=>{
 const received:any[]=[];
 const fixture=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  received.push({url:req.url,method:req.method,body:raw&&JSON.parse(raw)});
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(req.method==='POST'?{id:'FOLD12',title:'Notes',format:'folder',parent_id:null}:
   {group:{id:'grp_team',handle:'team',role:'editor'}}));
 });
 await new Promise<void>(resolve=>fixture.listen(0,'127.0.0.1',resolve));
 try{
  const origin='http://127.0.0.1:'+(fixture.address() as {port:number}).port;
  const archive=await archiveFor(origin);const zip=path.join(root,'candidate.zip');
  await writeFile(zip,archive.bytes);await run('unzip',['-q',zip,'-d',root]);
  const cwd=path.join(root,'artifactbin'),journal=path.join(root,'request.json');
  const commandEnv={...process.env,ARTIFACTBIN_URL:origin,ARTIFACTBIN_TOKEN:'synthetic',
   ARTIFACTBIN_HOME:path.join(root,'home')};
  const {stdout}=await run(process.execPath,['scripts/groups.mjs','folder-create','team',
   '--title','Notes','--request',journal,'--json'],{cwd,env:commandEnv});
  expect(JSON.parse(stdout)).toMatchObject({id:'FOLD12',format:'folder'});
  expect(received.map(item=>[item.method,item.url])).toEqual([
   ['GET','/api/groups/team'],['POST','/api/artifacts']]);
  expect(received[1].body).toEqual({format:'folder',title:'Notes',visibility:'private',
   destination:{type:'group',id:'grp_team'}});
  const help=await run(process.execPath,['scripts/groups.mjs','--help'],{cwd,env:commandEnv});
  expect(help.stdout).toContain('collection GROUP');expect(help.stdout).toContain('folder-create');
 }finally{await new Promise<void>((resolve,reject)=>fixture.close(error=>error?reject(error):resolve()));}
}));
