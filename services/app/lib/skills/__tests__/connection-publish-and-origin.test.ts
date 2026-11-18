/**
 * `publish --type connection`: a dry run creates nothing (and never reads the secret), and the publish flags that
 * do not apply to a connection are refused by name before any request. And ARTIFACTBIN_URL names its origin however
 * it is spelled: a trailing slash or capital letters select the same server and keep the environment grant.
 */
import {it,expect,onTestFinished} from 'vitest';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {publishCommand} from '../../../skills/artifactbin/scripts/toolbox-publish.mjs';
import {makeClient,selectedServer} from '../../../skills/artifactbin/scripts/toolbox-client.mjs';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {syntheticEnv} from '@/test/helpers/toolbox-env';

const server='https://example.test';
async function connectionFile(work:(file:string)=>Promise<void>){
 const root=await tempDir('connection-publish-',onTestFinished);
 const file=path.join(root,'db.json');await writeFile(file,JSON.stringify({connector:'postgres',host:'db.example.test',port:5432,database:'shop',user:'reader'}));await work(file);
}
const recording=()=>{const calls:{method:string;url:string}[]=[];return {calls,fetcher:async(url:any,init:any)=>{
 calls.push({method:init?.method??'GET',url:String(url)});
 if(String(url).endsWith('/api/connections'))return Response.json({connectors:[{id:'postgres',fields:[{name:'password',secret:true}]}]});
 if(String(url).includes('/api/groups/'))return Response.json({group:{id:'grp_team',handle:'team',role:'editor'}});
 return Response.json({id:'CONN12',url:server+'/a/CONN12'},{status:201});
}};};

it('dry-runs a connection without creating it or reading its secret',async()=>connectionFile(async file=>{
 const {calls,fetcher}=recording();
 const options={env:syntheticEnv(server, undefined, { token: 'synthetic-fixture' }),fetcher,log:()=>{}};
 // The secret path does not exist: reading it would throw.
 const planned=await publishCommand({positionals:[file],values:{type:'connection','dry-run':true,group:'team','secret-file':path.join(file,'missing')}},options);
 expect(planned).toMatchObject({dryRun:true,server,type:'connection',method:'POST',destination:{type:'group',id:'grp_team'}});
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
 const made=await publishCommand({positionals:[file],values:{type:'connection'}},options);
 expect(made).toMatchObject({id:'CONN12'});
 expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
}));

it.each([['visibility','public'],['personal',true],['create',true],['template','read-only']])(
 'refuses --%s for a connection by name, before any request',async(flag,value)=>connectionFile(async file=>{
 const {calls,fetcher}=recording();
 const options={env:syntheticEnv(server, undefined, { token: 'synthetic-fixture' }),fetcher,log:()=>{}};
 const refused=await publishCommand({positionals:[file],values:{type:'connection',[flag]:value}},options).catch((error:any)=>error);
 expect(refused).toMatchObject({exit:2,code:'flag_not_supported'});
 expect(refused.message).toContain(`--${flag}`);
 expect(calls).toEqual([]);
}));

it.each(['https://example.test/','HTTPS://Example.TEST','https://EXAMPLE.test/'])(
 'reads ARTIFACTBIN_URL %s as its origin, and its environment grant answers for it',async url=>{
 const env=syntheticEnv(url, undefined, { token: 'synthetic-fixture' });
 expect(selectedServer({},env)).toBe(server);
 const seen:string[]=[];
 const client=makeClient(selectedServer({},env),{env,fetcher:async(target:any,init:any)=>{
  seen.push(`${String(target)} ${new Headers(init.headers).get('Authorization')}`);return Response.json({ok:true});}});
 expect(await client.request('/api/me')).toEqual({ok:true});
 expect(seen).toEqual([`${server}/api/me Bearer synthetic-fixture`]);
});

it('keeps refusing an environment grant that belongs to another origin',async()=>{
 const env=syntheticEnv('https://other.test/', undefined, { token: 'synthetic-fixture' });
 const client=makeClient(server,{env,fetcher:async()=>Response.json({})});
 await expect(client.request('/api/me')).rejects.toMatchObject({code:'credential_origin_mismatch'});
});
