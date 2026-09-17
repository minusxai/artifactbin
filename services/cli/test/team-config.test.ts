import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareServe} from '../src/serve-config';
import {teamSettings} from '../src/team-config';
const settings='APP__HOST=0.0.0.0\nAPP__PORT=7445\nAPP__PUBLIC_BASE_URL=https://team.example.test\nAUTH__SECRET='+ 's'.repeat(48)+'\n';
test('team operator settings isolate database, objects, identity and service cache from the client and shell',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-team-'));
 try{
 const file=join(directory,'server.env');await writeFile(file,settings+'EMAIL__FROM=Team <team@example.test>\n');
 const result=await teamSettings(file,{PATH:'/bin',ARTIFACTBIN_HOME:'/secret/client',ARTIFACTBIN_TOKEN:'secret',DATABASE_URL:'postgres://remote',AUTH__SECRET:'wrong',SQL__SERVICE_URL:'https://remote',S3_URL:'s3://remote'});
 assert.equal(result.host,'0.0.0.0');assert.equal(result.port,7445);assert.equal(result.origin,'https://team.example.test');
 assert.equal(result.env.DATABASE_URL,'pglite://'+join(result.directory,'data/pglite'));
 assert.equal(result.env.OBJECT_STORE__LOCAL_DIR,join(result.directory,'data/objects'));
 assert.equal(result.env.ARTIFACTBIN_HOME,join(result.directory,'data/runtime'));
 assert.equal(result.env.EMAIL__DEV_OUTBOX_PATH,join(result.directory,'data/outbox.jsonl'));
 assert.equal(result.env.AUTH__SECRET,'s'.repeat(48));assert.equal(result.env.EMAIL__FROM,'Team <team@example.test>');
 assert.equal(result.env.ARTIFACTBIN_TOKEN,undefined);assert.equal(result.env.SQL__SERVICE_URL,undefined);assert.equal(result.env.S3_URL,undefined);assert.equal(result.env.PATH,'/bin');
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('team settings reject missing identity, malformed origins and unrelated namespaces',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-team-'));
 try{
 const file=join(directory,'server.env');
 for(const text of [settings.replace(/AUTH__SECRET=.*\n/,''),settings.replace('https://team.example.test','https://user:password@team.example.test'),settings+'SELF__PORT=0\n',settings+'PROXY__RATE_LIMIT_CONFIG_FILE=policy.yml\n',settings+'RATE_LIMITER__TRUSTED_PROXY_HOPS=1\n']){
 await writeFile(file,text);await assert.rejects(teamSettings(file),/team|Team/);
 }
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('team settings accept ordinary SQL limits and reject unrelated provider settings',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-team-settings-'));
 try{
  const file=join(directory,'server.env');await writeFile(file,settings+'SQL__MAX_QUERY_ROWS=300\n');
  assert.equal((await teamSettings(file)).env.SQL__MAX_QUERY_ROWS,'300');
  await writeFile(file,settings+'MODEL_PROVIDER__API_KEY=unused\n');
  await assert.rejects(teamSettings(file),/Unsupported team setting/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('database overrides leave uploaded objects and client state in their own directories',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-serve-db-'));
 try{
  const file=join(directory,'server.env');await writeFile(file,settings);
  const pg=await teamSettings(file,{}, {dbUrl:'postgres://localhost/artifactbin'});
  assert.equal(pg.env.DATABASE_URL,'postgres://localhost/artifactbin');assert.equal(pg.env.OBJECT_STORE__LOCAL_DIR,join(pg.directory,'data/objects'));
  const embedded=await teamSettings(file,{}, {dbUrl:'pglite://custom-db'});
  assert.equal(embedded.env.DATABASE_URL,'pglite://'+join(embedded.directory,'custom-db'));
  await assert.rejects(teamSettings(file,{}, {dbUrl:'sqlite://data'}),/database URL/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('first serve creates private persistent operator settings without client defaults',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-serve-init-'));
 try{
  const options={home,cwd:home,directory:'team',port:8123};
  const first=await prepareServe(options),bytes=await readFile(first.config,'utf8');
  assert.equal((await stat(first.config)).mode&0o777,0o600);
  assert.equal((await teamSettings(first.config,{},first.overrides)).port,8123);
  const again=await prepareServe({...options,port:8124,dbUrl:'postgres://localhost/app'});
  assert.equal(await readFile(again.config,'utf8'),bytes);
  const settings=await teamSettings(again.config,{},again.overrides);
  assert.equal(settings.port,8124);assert.equal(settings.origin,'http://127.0.0.1:8124');
  assert.equal(settings.env.DATABASE_URL,'postgres://localhost/app');
  await assert.rejects(stat(join(home,'.artifactbin/config.json')),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});
