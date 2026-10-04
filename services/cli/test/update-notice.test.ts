import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkUpdateNotice} from '../src/update-notice';
import {HttpClient} from '../src/http';

test('normal compatible write carries hourly notice metadata without an extra HTTP request',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-notice-'));let now=1000,calls=0;const output:string[]=[];
 try{
  const client=new HttpClient({connection:{server:'https://example.test',token:'test'},onRelease:release=>checkUpdateNotice({home,server:'https://example.test',env:{},release,now:()=>now,currentVersion:'1.0.0',stderr:value=>output.push(value)}),fetch:async()=>{calls++;return Response.json({accepted:true},{headers:{'X-Artifactbin-Protocol':'3','X-Artifactbin-CLI-Version':'2.0.0'}});}});
  assert.deepEqual(await client.request('/artifacts','POST',{}),{accepted:true});assert.equal(calls,1);assert.equal(output.length,1);assert.match(output[0],/npx --yes @artifactbin\/cli@2\.0\.0/);
  await client.request('/artifacts','POST',{});assert.equal(calls,2);assert.equal(output.length,1);
  now+=3600001;await client.request('/artifacts','POST',{});assert.equal(calls,3);assert.equal(output.length,2);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('missing metadata, local, pinned, disabled and npm offline calls send no update requests',async()=>{
 let queries=0,notices=0;
 const options={home:'/unused',server:'https://example.test',fetch:async()=>{queries++;return Response.json({version:'2.0.0',protocol:3});},stderr:()=>{notices++;}};
 for(const extra of [{},{localOnly:true},{env:{CLI__VERSION_PIN:'1.0.0'}},{env:{CLI__AUTO_UPDATE:'off'}},{env:{npm_config_offline:'true'}}])await checkUpdateNotice({...options,...extra});
 for(const env of [{CLI__VERSION_PIN:'1.0.0'},{npm_config_offline:'true'}])await checkUpdateNotice({...options,env,release:{version:'2.0.0',protocol:3}});
 assert.equal(queries,0);assert.equal(notices,0);
});
test('bad metadata and notice failures never fail requests or trigger release queries',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-notice-'));let calls=0;
 try{
  const client=new HttpClient({connection:{server:'https://example.test',token:'test'},onRelease:async()=>{throw new Error('notice unavailable');},fetch:async()=>{calls++;return Response.json({accepted:true},{headers:{'X-Artifactbin-Protocol':'3','X-Artifactbin-CLI-Version':'2.0.0'}});}});
  assert.deepEqual(await client.request('/artifacts','POST',{}),{accepted:true});assert.equal(calls,1);
  await checkUpdateNotice({home,server:'https://example.test',env:{},release:{version:'2.0.0;evil',protocol:3},stderr:()=>assert.fail('no notice'),fetch:async()=>assert.fail('no query')});
 }finally{await rm(home,{recursive:true,force:true});}
});
