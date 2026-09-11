import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {HttpClient,httpStatus} from '../src/http';
import {CliError} from '../src/errors';

/** `remote` rides the shared client, so a rejected token starts browser sign-in and the command resumes with the new one. */
test('a rejected token on afbin remote starts sign-in immediately and resumes the session with the approved credential',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-remote-auth-'));
 try{
  await saveConnection({server:'https://example.com',token:'stale'},root);
  const calls:string[]=[];const out:string[]=[];const err:string[]=[];
  const view={session:{id:'rs_1',name:'pi',harness:'pi',cwd:'/w',machine:'m',cols:80,rows:24,online:false,exitCode:0,controller:'local',createdAt:'2026-09-11T00:00:00Z'},generation:'g1',seq:0,frames:[],snapshot:''};
  const code=await runCli(['remote','--session','rs_1','--no-browser','--server','https://example.com'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:s=>err.push(s),fetch:async(input,init)=>{
   const request=new Request(input,init);const path=new URL(request.url).pathname;const token=request.headers.get('Authorization');
   calls.push(`${request.method} ${path} ${token??''}`.trim());
   if(path==='/oauth/device')return Response.json({device_code:'d'.repeat(43),user_code:'ABCD',verification_uri_complete:'https://example.com/oauth/device?code=ABCD',expires_in:300,interval:5});
   if(path==='/oauth/device/token')return Response.json({access_token:'mx_fresh',refresh_token:'mxr_fresh',client_id:'afbin_client',expires_in:3600});
   if(path==='/api/remote/sessions/rs_1')return token==='Bearer mx_fresh'?Response.json(view):Response.json({error:'unauthorized'},{status:401});
   return Response.json({error:'not_found'},{status:404});
  }});
  assert.equal(code,0,out.join('')+err.join(''));
  const refused=calls.indexOf('GET /api/remote/sessions/rs_1 Bearer stale');
  const signIn=calls.findIndex(call=>call.startsWith('POST /oauth/device'));
  const resumed=calls.indexOf('GET /api/remote/sessions/rs_1 Bearer mx_fresh');
  assert.ok(refused>=0&&signIn>refused&&resumed>signIn,`refuse, sign in, resume:\n${calls.join('\n')}`);
  assert.doesNotMatch(err.join(''),/at .*\.ts:\d+/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an unreachable server is a refusal naming the server, and a plain-text failure keeps its HTTP status',async()=>{
 const closed=createServer();await new Promise<void>(resolve=>closed.listen(0,'127.0.0.1',resolve));
 const port=(closed.address() as {port:number}).port;await new Promise<void>(resolve=>closed.close(()=>resolve()));
 await assert.rejects(new HttpClient({connection:{server:`http://127.0.0.1:${port}`,token:'test'}}).request('/remote/sessions/rs_1'),(error:unknown)=>{
  assert.ok(error instanceof CliError);assert.equal(error.code,'transport_error');
  assert.match(error.message,new RegExp(`Cannot reach http://127.0.0.1:${port}`));assert.match(error.fix??'',/--server/);
  return true;
 });
 const server=createServer((_req,res)=>{res.writeHead(500,{'Content-Type':'text/plain'});res.end('Internal Server Error');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address() as {port:number};
  await assert.rejects(new HttpClient({connection:{server:`http://127.0.0.1:${address.port}`,token:'test'}}).request('/remote/sessions'),(error:unknown)=>{
   assert.ok(error instanceof CliError);assert.equal(error.code,'http_500');assert.equal(httpStatus(error),500);return true;
  });
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
