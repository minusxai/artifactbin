import {it,expect} from 'vitest';
const server='https://example.test';
async function harness(sub:string,positionals:string[],values:Record<string,unknown>={},fail?:string){
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');
 const calls:{path:string;method:string;body:any}[]=[];
 const result=await groupsCommand({sub,positionals,values},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async(url:any,init:any)=>{
  const path=new URL(String(url)).pathname;const method=init.method;const body=init.body?JSON.parse(init.body):undefined;calls.push({path,method,body});
  if(fail&&path.includes(fail))return Response.json({error:'forbidden'},{status:403});
  if(path==='/a/PAGE12/raw')return new Response('<link rel="af-dataset" data-af-name="entries" href="ref:DATA01"><link rel="af-dataset" href="ref:DATA02">',{headers:{'Content-Type':'text/html'}});
  if(path.endsWith('/members'))return Response.json({members:[{user_id:'usr_member',username:'teammate',name:'Team Mate'}]});
  if(path.endsWith('/invitations')&&method==='GET')return Response.json({invitations:[{id:'gin_pending',email:'pending@example.test'}]});
  if(method==='GET'&&path.startsWith('/api/groups/'))return Response.json({group:{id:path.endsWith('/other')?'grp_other':'grp_stable',handle:'design_crit'},members:[]});
  return Response.json({changed:true});
 }});return {result,calls};
}
it.each(['remove','leave','move','delete','invite','role','share'])('%s refuses before any HTTP without --yes',async sub=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');let calls=0;
 await expect(groupsCommand({sub,positionals:sub==='invite'?['design_crit','a@example.test']:sub==='role'||sub==='remove'?['design_crit','teammate']:['PAGE12'],values:{group:'design_crit',role:'editor',handle:'design_crit'}},{fetcher:async()=>{calls++;throw Error('unexpected');}})).rejects.toMatchObject({exit:2,code:'confirmation_required'});expect(calls).toBe(0);
});
it.each([
 ['list',[],{},'/api/groups','GET',undefined],
 ['show',['design_crit'],{},'/api/groups/design_crit','GET',undefined],
 ['create',['design_crit'],{name:'Design Crit'},'/api/groups','POST',{handle:'design_crit',name:'Design Crit'}],
 ['update',['design_crit'],{name:'New'},'/api/groups/grp_stable','PATCH',{name:'New'}],
 ['invite',['design_crit','a@example.test'],{},'/api/groups/grp_stable/invitations','POST',{email:'a@example.test',role:'member'}],
 ['uninvite',['design_crit','pending@example.test'],{yes:true},'/api/groups/grp_stable/invitations/gin_pending','DELETE',undefined],
 ['role',['design_crit','teammate'],{role:'member'},'/api/groups/grp_stable/members/usr_member','PUT',{role:'member'}],
 ['remove',['design_crit','teammate'],{yes:true},'/api/groups/grp_stable/members/usr_member','DELETE',undefined],
 ['leave',['design_crit'],{yes:true},'/api/groups/grp_stable/members/me','DELETE',undefined],
 ['share',['PAGE12'],{group:'design_crit',role:'commenter'},'/api/artifacts/PAGE12/group-shares/grp_stable','PUT',{role:'commenter'}],
 ['unshare',['PAGE12'],{group:'design_crit',yes:true},'/api/artifacts/PAGE12/group-shares/grp_stable','DELETE',undefined],
 ['move',['PAGE12'],{group:'design_crit',yes:true},'/api/artifacts/PAGE12/transfer','POST',{destination:{type:'group',id:'grp_stable'}}],
 ['link',['design_crit','other'],{},'/api/groups/grp_stable/links/grp_other','PUT',undefined],
 ['unlink',['design_crit','other'],{yes:true},'/api/groups/grp_stable/links/grp_other','DELETE',undefined],
 ['delete',['design_crit'],{yes:true,handle:'design_crit'},'/api/groups/grp_stable','DELETE',{handle:'design_crit'}],
] as const)('%s sends its documented stable-ID protocol',async(sub,args,values,path,method,body)=>{
 const {calls}=await harness(sub,[...args],values);expect(calls.at(-1)).toEqual({path,method,body});
 if(!['list','create','show','link','unlink'].includes(sub))expect(calls.filter(c=>c.path==='/api/groups/design_crit')).toHaveLength(1);
});
it('create --parent resolves the parent once and sends its stable ID',async()=>{
 const {calls}=await harness('create',['retail'],{name:'Retail',parent:'other'});
 expect(calls).toEqual([{path:'/api/groups/other',method:'GET',body:undefined},{path:'/api/groups',method:'POST',body:{handle:'retail',name:'Retail',parent_id:'grp_other'}}]);
});
it('reparent sends the parent it read, refuses before HTTP without --yes or with both --parent and --root',async()=>{
 const {calls}=await harness('reparent',['design_crit'],{parent:'other',yes:true});
 expect(calls.at(-1)).toEqual({path:'/api/groups/grp_stable/parent',method:'PUT',body:{parent_id:'grp_other',from_parent_id:null}});
 expect((await harness('reparent',['design_crit'],{root:true,yes:true})).calls.at(-1)).toEqual({path:'/api/groups/grp_stable/parent',method:'PUT',body:{parent_id:null,from_parent_id:null}});
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');let sent=0;
 const fetcher=async()=>{sent++;throw Error('unexpected');};
 await expect(groupsCommand({sub:'reparent',positionals:['design_crit'],values:{parent:'other'}},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher})).rejects.toMatchObject({code:'confirmation_required',exit:2});
 await expect(groupsCommand({sub:'reparent',positionals:['design_crit'],values:{parent:'other',root:true,yes:true}},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher})).rejects.toMatchObject({code:'invalid_parent',exit:2});
 expect(sent).toBe(0);
});
it('share --datasets reads the page first, then shares it at its role and each linked dataset at viewer',async()=>{
 const {result,calls}=await harness('share',['PAGE12'],{group:'design_crit',role:'commenter',datasets:true});
 expect(calls.filter(c=>c.method!=='GET')).toEqual([
  {path:'/api/artifacts/PAGE12/group-shares/grp_stable',method:'PUT',body:{role:'commenter'}},
  {path:'/api/artifacts/DATA01/group-shares/grp_stable',method:'PUT',body:{role:'viewer'}},
  {path:'/api/artifacts/DATA02/group-shares/grp_stable',method:'PUT',body:{role:'viewer'}}]);
 expect(calls.findIndex(c=>c.path==='/a/PAGE12/raw')).toBeLessThan(calls.findIndex(c=>c.method==='PUT'));
 expect(result).toMatchObject({ok:true,code:'completed',page:{id:'PAGE12',role:'commenter',changed:true},datasets:[{id:'DATA01',name:'entries',role:'viewer',ok:true},{id:'DATA02',name:'DATA02',role:'viewer',ok:true}]});
 const undone=await harness('unshare',['PAGE12'],{group:'design_crit',datasets:true,yes:true});
 expect(undone.calls.filter(c=>c.method!=='GET').map(c=>c.method+' '+c.path)).toEqual(['DELETE /api/artifacts/PAGE12/group-shares/grp_stable','DELETE /api/artifacts/DATA01/group-shares/grp_stable','DELETE /api/artifacts/DATA02/group-shares/grp_stable']);
 expect(undone.result).toMatchObject({ok:true,page:{id:'PAGE12'},datasets:[{id:'DATA01',ok:true},{id:'DATA02',ok:true}]});
});
it('share --datasets reports a dataset refusal without hiding the shares that succeeded, and refuses editor before HTTP',async()=>{
 const {result}=await harness('share',['PAGE12'],{group:'design_crit',datasets:true},'/DATA01/');
 expect(result).toMatchObject({ok:false,code:'partial_failure',exit:3,page:{id:'PAGE12',role:'viewer',changed:true},datasets:[{id:'DATA01',ok:false,code:'forbidden'},{id:'DATA02',ok:true}]});
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');let calls=0;
 await expect(groupsCommand({sub:'share',positionals:['PAGE12'],values:{group:'design_crit',role:'editor',datasets:true,yes:true}},{fetcher:async()=>{calls++;throw Error('unexpected');}})).rejects.toMatchObject({code:'datasets_editor',exit:2});expect(calls).toBe(0);
});
it('reports multiple invitations individually, including partial failure',async()=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');let n=0;
 const result=await groupsCommand({sub:'invite',positionals:['design_crit','a@example.test','b@example.test'],values:{}},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async(_url:any,init:any)=>init.method==='GET'?Response.json({group:{id:'grp_stable',handle:'design_crit'}}):++n===1?Response.json({changed:true}):Response.json({error:'rate_limited',retry_after:60},{status:429})});
 expect(result.ok).toBe(false);expect(result.results.map((r:any)=>r.ok)).toEqual([true,false]);expect(result.results[1].code).toBe('rate_limited');
});
it('propagates server refusal instead of claiming a mutation succeeded',async()=>{
 await expect(harness('leave',['design_crit'],{yes:true},'/members/me')).rejects.toMatchObject({code:'forbidden',exit:3});
});
it.each(['uninvite','unshare','unlink'])('%s also refuses before HTTP without destructive consent',async sub=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');let calls=0;
 await expect(groupsCommand({sub,positionals:['design_crit','other'],values:{group:'design_crit'}},{fetcher:async()=>{calls++;throw Error('unexpected');}})).rejects.toMatchObject({exit:2,code:'confirmation_required'});expect(calls).toBe(0);
});
it('show ends on how to change its members and invitations: proposed to the user by handle, role and email, made after they agree',async()=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');
 const detail={group:{id:'grp_stable',handle:'design_crit'},members:[{user_id:'usr_a',username:'teammate',role:'editor'}],invitations:[{id:'gin_a',email:'pending@example.test',role:'member'}]};
 const options=(body:any)=>({env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async()=>Response.json(body)});
 const shown=await groupsCommand({sub:'show',positionals:['design_crit'],values:{}},options(detail));
 expect(shown).toMatchObject(detail);
 expect(shown.next).toBe('Next: members show handles, not email addresses. A change to these members or invitations is proposed to the user before it is made: name each member by handle and role (for a person the user named by address, the member you take them to be, or the members you cannot tell apart; an address missing here does not mean they are not a member) and each invitation by its email, with the action for each (remove, change role, cancel the invitation); make it only after they agree.');
 // A group with no members or invitations listed has nothing to propose.
 expect((await groupsCommand({sub:'show',positionals:['design_crit'],values:{}},options({group:detail.group,members:[]}))).next).toBeUndefined();
});
it('show --pages binds the stable group ID and cursor while retaining the server page envelope',async()=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');const seen:string[]=[];
 const pages={artifacts:[{id:'PAGE12',owner:{type:'personal',id:'usr_owner'}}],next_cursor:'next'};
 const result=await groupsCommand({sub:'show',positionals:['@design_crit'],values:{pages:true,cursor:'opaque+/='}},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async(url:any)=>{seen.push(String(url));return Response.json(seen.length===1?{group:{id:'grp_stable',handle:'design_crit'}}:pages);}});
 expect(new URL(seen[1]!).searchParams.get('group_id')).toBe('grp_stable');expect(new URL(seen[1]!).searchParams.get('cursor')).toBe('opaque+/=');expect(result.pages).toEqual(pages);
});
it.each(['not_member','ambiguous_member'])('refuses %s without a member mutation or global account search',async expected=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');const seen:string[]=[];
 await expect(groupsCommand({sub:'role',positionals:['design_crit','same'],values:{role:'member'}},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async(url:any)=>{
  const path=new URL(String(url)).pathname;seen.push(path);return Response.json(path.endsWith('/members')?{members:expected==='not_member'?[]:[{user_id:'usr_a',name:'same'},{user_id:'usr_b',name:'same'}]}:{group:{id:'grp_stable',handle:'design_crit'}});
 }})).rejects.toMatchObject({code:expected,exit:3});expect(seen).toEqual(['/api/groups/design_crit','/api/groups/grp_stable/members']);
});
it('delete mismatched handle refuses after one read and before any mutation',async()=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');let calls=0;
 await expect(groupsCommand({sub:'delete',positionals:['design_crit'],values:{yes:true,handle:'other'}},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async(_url:any,init:any)=>{calls++;expect(init.method).toBe('GET');return Response.json({group:{id:'grp_stable',handle:'design_crit'}});}})).rejects.toMatchObject({code:'handle_mismatch',exit:2});expect(calls).toBe(1);
});
it('uses explicit personal move and rejects ambiguous destinations before HTTP',async()=>{
 expect((await harness('move',['PAGE12'],{personal:true,yes:true})).calls).toEqual([{path:'/api/artifacts/PAGE12/transfer',method:'POST',body:{destination:{type:'personal'}}}]);
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');
 await expect(groupsCommand({sub:'move',positionals:['PAGE12'],values:{personal:true,group:'design_crit',yes:true}})).rejects.toMatchObject({code:'invalid_destination',exit:2});
});
it('rejects credential and artifact origin mismatches before HTTP',async()=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');let calls=0;const options={env:{ARTIFACTBIN_URL:'https://other.test',ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async()=>{calls++;throw Error('unexpected');}};
 await expect(groupsCommand({sub:'list',positionals:[],values:{server}},options)).rejects.toMatchObject({code:'credential_origin_mismatch',exit:3});
 await expect(groupsCommand({sub:'share',positionals:['https://other.test/a/PAGE12'],values:{server,group:'design_crit'}},options)).rejects.toMatchObject({code:'origin_mismatch',exit:2});expect(calls).toBe(0);
});
it.each(['list','show','create','update','invite','uninvite','role','remove','leave','share','unshare','move','link','unlink','delete'])('%s preserves access errors',async sub=>{
 const args=sub==='list'?[]:sub==='invite'?['design_crit','a@example.test']:['role','remove','link','unlink'].includes(sub)?['design_crit','teammate']:sub==='uninvite'?['design_crit','pending@example.test']:['share','unshare','move'].includes(sub)?['PAGE12']:['design_crit'];
 // Refuse the first request: a failed identity resolution must never fall through to writes.
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');let calls=0;
 await expect(groupsCommand({sub,positionals:args,values:{yes:true,role:sub==='share'?'viewer':'member',group:'design_crit',name:'Name',handle:'design_crit'}},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async()=>{calls++;return Response.json({error:'forbidden'},{status:403});}})).rejects.toMatchObject({code:'forbidden',exit:3});expect(calls).toBe(1);
});
it('does not retry an uncertain mutation and reports exit 5',async()=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');let writes=0;
 await expect(groupsCommand({sub:'leave',positionals:['design_crit'],values:{yes:true}},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async(_url:any,init:any)=>{if(init.method==='GET')return Response.json({group:{id:'grp_stable',handle:'design_crit'}});writes++;throw Error('network failed');}})).rejects.toMatchObject({code:'outcome_unknown',exit:5});expect(writes).toBe(1);
});
it('runs every verb through the installed CLI JSON envelope and refuses output overwrite before HTTP',async()=>{
 const {createServer}=await import('node:http'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{mkdtemp,mkdir,writeFile,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const root=await mkdtemp(path.join(tmpdir(),'groups-cli-'));let requests=0;
 const http=createServer((req,res)=>{requests++;res.setHeader('Content-Type','application/json');const route=new URL(req.url!,'http://local').pathname;
  res.end(JSON.stringify(route.endsWith('/members')?{members:[{user_id:'usr_member',username:'teammate'}]}:route.endsWith('/invitations')&&req.method==='GET'?{invitations:[{id:'gin_pending',email:'pending@example.test'}]}:req.method==='GET'&&route.startsWith('/api/groups/')?{group:{id:route.endsWith('/other')?'grp_other':'grp_stable',handle:'design_crit'}}:{changed:true}));});
 await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));const address=http.address();if(!address||typeof address==='string')throw Error('no address');
 const origin='http://127.0.0.1:'+address.port;
 const {skillPackageFiles,skillTree,buildToolboxPlatform,buildPreviewParser}=await import('..');
 const files=skillPackageFiles(skillTree(),origin);
 files['scripts/toolbox-platform.mjs']=await buildToolboxPlatform();
 files['scripts/preview-html.mjs']=await buildPreviewParser(files['scripts/preview-html.mjs']!);
 const installed=path.join(root,'installed');await mkdir(path.join(installed,'scripts'),{recursive:true});
 for(const [name,content] of Object.entries(files))if(name.startsWith('scripts/'))await writeFile(path.join(installed,name),content);
 const script=path.join(installed,'scripts/groups.mjs');
 const run=(args:string[])=>promisify(execFile)(process.execPath,[script,...args,'--server',origin,'--json','--no-update'],{env:{...process.env,ARTIFACTBIN_URL:origin,ARTIFACTBIN_TOKEN:'synthetic',ARTIFACTBIN_HOME:root}});
 try{
  const invocations=[['list'],['show','design_crit'],['create','design_crit','--name','Design Crit'],['update','design_crit','--name','New'],['invite','design_crit','a@example.test'],['uninvite','design_crit','pending@example.test','--yes'],['role','design_crit','teammate','--role','member'],['remove','design_crit','teammate','--yes'],['leave','design_crit','--yes'],['share','PAGE12','--group','design_crit'],['share','PAGE12','--group','design_crit','--datasets'],['unshare','PAGE12','--group','design_crit','--yes'],['unshare','PAGE12','--group','design_crit','--datasets','--yes'],['move','PAGE12','--group','design_crit','--yes'],['link','design_crit','other'],['unlink','design_crit','other','--yes'],['delete','design_crit','--handle','design_crit','--yes']];
  for(const args of invocations){const output=await run(args);expect(JSON.parse(output.stdout),args[0]).toMatchObject({ok:true,code:'completed'});}
  const output=path.join(root,'receipt.json');await run(['list','--output',output]);expect(JSON.parse(await readFile(output,'utf8'))).toMatchObject({ok:true});
  await writeFile(output,'keep');const before=requests;
  await expect(run(['leave','design_crit','--yes','--output',output])).rejects.toMatchObject({code:2,stdout:expect.stringContaining('output_exists')});expect(requests).toBe(before);expect(await readFile(output,'utf8')).toBe('keep');
  await expect(run(['leave','design_crit'])).rejects.toMatchObject({code:2,stdout:expect.stringContaining('confirmation_required')});expect(requests).toBe(before);
 }finally{await new Promise<void>((resolve,reject)=>http.close(error=>error?reject(error):resolve()));await rm(root,{recursive:true,force:true});}
},20000);
it.each(['list','show','create','update','invite','uninvite','role','remove','leave','share','unshare','move','link','unlink','delete'])('%s rejects missing/extra positional arguments before HTTP',async sub=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');let calls=0;
 await expect(groupsCommand({sub,positionals:sub==='list'?['extra']:[],values:{yes:true,role:sub==='share'?'viewer':'member',group:'design_crit',name:'Name',handle:'design_crit'}},{fetcher:async()=>{calls++;throw Error('unexpected');}})).rejects.toMatchObject({code:'invalid_arguments',exit:2});expect(calls).toBe(0);
});
it.each(['create','update','invite','uninvite','role','remove','leave','share','unshare','move','link','unlink','delete'])('%s preserves a mutation refusal after successful identity resolution',async sub=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');let writes=0;
 const args=sub==='invite'?['design_crit','a@example.test']:['role','remove','link','unlink'].includes(sub)?['design_crit','teammate']:sub==='uninvite'?['design_crit','pending@example.test']:['share','unshare','move'].includes(sub)?['PAGE12']:['design_crit'];
 const pending=groupsCommand({sub,positionals:args,values:{yes:true,role:sub==='share'?'viewer':'member',group:'design_crit',name:'Name',handle:'design_crit'}},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async(url:any,init:any)=>{
  if(init.method!=='GET'){writes++;return Response.json({error:'forbidden'},{status:403});}
  const path=new URL(String(url)).pathname;
  return Response.json(path.endsWith('/members')?{members:[{user_id:'usr_member',username:'teammate'}]}:path.endsWith('/invitations')?{invitations:[{id:'gin_pending',email:'pending@example.test'}]}:{group:{id:'grp_stable',handle:'design_crit'}});
 }});
 if(sub==='invite')expect(await pending).toMatchObject({ok:false,code:'partial_failure',results:[{ok:false,code:'forbidden',exit:3}]});
 else await expect(pending).rejects.toMatchObject({code:'forbidden',exit:3});expect(writes).toBe(1);
});
it('an editor grant says what it gives, refused without --yes and once made; a viewer grant says nothing',async()=>{
 const {groupsCommand}=await import('../../../skills/artifactbin/scripts/groups.mjs');
 const {EDITOR_GRANT}=await import('../../../skills/artifactbin/scripts/toolbox-groups.mjs');
 expect(EDITOR_GRANT).toContain('Group Admins also');
 const cases:[string,string[],Record<string,unknown>][]=[['share',['PAGE12'],{group:'design_crit'}],['invite',['design_crit','a@example.test'],{}],['role',['design_crit','teammate'],{}]];
 for(const [sub,positionals,values] of cases){
  const refused=groupsCommand({sub,positionals,values:{...values,role:'editor'}},{fetcher:async()=>{throw Error('unexpected');}});
  await expect(refused,sub).rejects.toMatchObject({code:'confirmation_required',recovery:expect.stringContaining(EDITOR_GRANT)});
  expect((await harness(sub,positionals,{...values,role:'editor',yes:true})).result.note,sub).toBe(EDITOR_GRANT);
  expect((await harness(sub,positionals,{...values,role:sub==='share'?'viewer':'member'})).result.note,sub).toBeUndefined();
 }
 await expect(groupsCommand({sub:'remove',positionals:['design_crit','teammate'],values:{}},{fetcher:async()=>{throw Error('unexpected');}})).rejects.toMatchObject({recovery:expect.not.stringContaining(EDITOR_GRANT)});
});
