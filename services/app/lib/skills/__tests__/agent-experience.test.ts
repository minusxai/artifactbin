import {it,expect} from 'vitest';
/** What an agent sees when sign-in lapses, and how it anchors a comment without guessing a revision. */
it('reports a lapsed sign-in as auth_required with the login command, exit 3',async()=>{
 const {toolFailure,toolExit}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const lapsed=new Error('auth_required: credentials could not be refreshed.');
 expect(toolFailure('publish',lapsed)).toMatchObject({ok:false,code:'auth_required',message:'Sign-in expired: run node scripts/auth.mjs login --email ADDRESS'});
 expect(toolExit(lapsed)).toBe(3);
 expect(toolFailure('publish',new Error('boom')).code).toBe('operation_failed');
 expect(toolExit(new Error('boom'))).toBe(1);
});
it('auth status runs a real refresh and reports authenticated:false when it fails',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {authCommand}=await import('../../../skills/artifactbin/scripts/auth.mjs');
 const {platform}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'status-refresh-')),server='https://example.test';
 try{
  const shared=await platform();
  await shared.saveCredentials({server,token:'old_access',refreshToken:'old_refresh',clientId:'client_1',expiresAt:Date.now()-1000},root);
  const run=(answer:Response)=>authCommand({sub:'status',values:{},positionals:[]},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_HOME:root},fetcher:async()=>answer});
  expect(await run(Response.json({error:'invalid_grant'},{status:400}))).toMatchObject({authenticated:false,source:'private-store'});
  expect(await run(Response.json({access_token:'new_access',refresh_token:'new_refresh',expires_in:3600}))).toMatchObject({authenticated:true,expired:false});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('fills the anchor revision from the current page when the anchor omits it',async()=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'anchor-revision-')),calls:any[]=[],body=path.join(root,'body.md'),anchor=path.join(root,'anchor.json');
 await writeFile(body,'Tighten this');await writeFile(anchor,JSON.stringify({kind:'html-node',v:1,nodeId:'n1',quote:'same words'}));
 const options={env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic',ARTIFACTBIN_HOME:root},fetcher:async(url:any,init:any)=>{calls.push({url:String(url),...init});return String(url).endsWith('/annotations')?Response.json({id:'ann_1',revision:1,thread:[]}):Response.json({id:'PAGE12',version:7});}};
 try{
  await commentCommand({sub:'add',values:{anchor,'body-file':body},positionals:['PAGE12']},options);
  const sent=calls.find(call=>call.url.endsWith('/annotations'));
  expect(JSON.parse(sent.body).anchor).toEqual({kind:'html-node',v:1,revision:'7',nodeId:'n1',quote:'same words'});
 }finally{await rm(root,{recursive:true,force:true});}
});
