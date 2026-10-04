import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkUpdateNotice} from '../src/update-notice';

test('notices are per server, hourly, stderr only, and never install anything',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-notice-'));let now=1000,calls=0;const output:string[]=[];
 const options={home,server:'https://example.test',env:{},now:()=>now,currentVersion:'1.0.0',stderr:(s:string)=>output.push(s),fetch:async(input:unknown,init?:RequestInit)=>{calls++;assert.equal(String(input),'https://example.test/chat/release.json');assert.equal(new Headers(init?.headers).has('Authorization'),false);return Response.json({version:'2.0.0',protocol:3});}};
 try{await checkUpdateNotice(options);await checkUpdateNotice(options);assert.equal(calls,1);assert.match(output[0],/npx --yes @artifactbin\/cli@2\.0\.0/);now+=3600001;await checkUpdateNotice(options);assert.equal(calls,2);}finally{await rm(home,{recursive:true,force:true});}
});
test('local, pinned and disabled commands send no notice requests',async()=>{
 for(const extra of [{localOnly:true},{env:{CLI__VERSION_PIN:'1.0.0'}},{env:{CLI__AUTO_UPDATE:'off'}}])await checkUpdateNotice({home:'/unused',server:'https://example.test',fetch:async()=>assert.fail('no request'),stderr:()=>assert.fail('no notice'),...extra});
});
test('failed and malformed checks never fail commands and failures back off',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-notice-'));let calls=0;
 try{const options={home,server:'https://example.test',env:{},stderr:()=>assert.fail('no notice'),fetch:async()=>{calls++;throw new Error('offline');}};await checkUpdateNotice(options);await checkUpdateNotice(options);assert.equal(calls,1);await checkUpdateNotice({...options,server:'https://other.test',fetch:async()=>Response.json({version:'2.0.0;evil',protocol:3})});}finally{await rm(home,{recursive:true,force:true});}
});
