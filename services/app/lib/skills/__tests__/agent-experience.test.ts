import {it,expect,onTestFinished} from 'vitest';
import {syntheticEnv} from './toolbox-env';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tempDir} from '@artifactbin/test-support/temp-dir';
/** What an agent sees when sign-in lapses, and how it anchors a comment without guessing a revision. */
it('reports a lapsed sign-in as auth_required with the login command, exit 3',async()=>{
 const {toolFailure,toolExit}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const lapsed=new Error('auth_required: credentials could not be refreshed.');
 expect(toolFailure('publish',lapsed)).toMatchObject({ok:false,code:'auth_required',message:'Sign-in expired: run node scripts/auth.mjs login --email ADDRESS'});
 expect(toolExit(lapsed)).toBe(3);
 expect(toolFailure('publish',new Error('boom')).code).toBe('operation_failed');
 expect(toolExit(new Error('boom'))).toBe(1);
});
it('names the real cause of an unexpected failure, first line only, bounded and without secrets',async()=>{
 const {toolFailure}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 expect(toolFailure('check',new Error('Mismatched browser receipt.\n    at inspectViewport (x.mjs:1)')).message).toBe('Operation failed; inspect the selected files and server. Cause: Mismatched browser receipt.');
 const leaked=toolFailure('publish',new Error('upstream said Bearer mxmx_secret_value and key '+'a1B2c3D4'.repeat(6))).message;
 expect(leaked).toContain('Cause: upstream said Bearer [redacted] and key [redacted]');
 expect(leaked).not.toMatch(/mxmx_secret_value|a1B2c3D4a1B2/);
 expect(toolFailure('publish',new Error('x'.repeat(5)+' '+'word '.repeat(200))).message.length).toBeLessThanOrEqual('Operation failed; inspect the selected files and server. Cause: '.length+300);
 expect(toolFailure('publish',new Error('')).message).toBe('Operation failed; inspect the selected files and server.');
});
it('auth status runs a real refresh and reports authenticated:false when it fails',async()=>{
 const {authCommand}=await import('../../../skills/artifactbin/scripts/auth.mjs');
 const {platform}=await import('../../../skills/artifactbin/scripts/toolbox-client.mjs');
 const root=await tempDir('status-refresh-',onTestFinished),server='https://example.test';
  const shared=await platform();
  await shared.saveCredentials({server,token:'old_access',refreshToken:'old_refresh',clientId:'client_1',expiresAt:Date.now()-1000},root);
  const run=(answer:Response)=>authCommand({sub:'status',values:{},positionals:[]},{env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_HOME:root},fetcher:async()=>answer});
  expect(await run(Response.json({error:'invalid_grant'},{status:400}))).toMatchObject({authenticated:false,source:'private-store'});
  expect(await run(Response.json({access_token:'new_access',refresh_token:'new_refresh',expires_in:3600}))).toMatchObject({authenticated:true,expired:false});
});
it('fills the anchor revision from the current page when the anchor omits it',async()=>{
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const root=await tempDir('anchor-revision-',onTestFinished),calls:any[]=[],body=path.join(root,'body.md'),anchor=path.join(root,'anchor.json');
 await writeFile(body,'Tighten this');await writeFile(anchor,JSON.stringify({kind:'html-node',v:1,nodeId:'n1',quote:'same words'}));
 const options={env:syntheticEnv('https://example.test',root),fetcher:async(url:any,init:any)=>{calls.push({url:String(url),...init});return String(url).endsWith('/annotations')?Response.json({id:'ann_1',revision:1,thread:[]}):Response.json({id:'PAGE12',version:7});}};
  await commentCommand({sub:'add',values:{anchor,'body-file':body},positionals:['PAGE12']},options);
  const sent=calls.find(call=>call.url.endsWith('/annotations'));
  expect(JSON.parse(sent.body).anchor).toEqual({kind:'html-node',v:1,revision:'7',nodeId:'n1',quote:'same words'});
});
