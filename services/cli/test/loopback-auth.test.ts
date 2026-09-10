import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loopbackAuthenticate} from '../src/loopback-auth';
import {loadConnection} from '../src/config';
test('browser loopback checks state and PKCE before saving credentials',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-loopback-'));let challenge='';let callback='';let exchanges=0;
 try{
  const connection=await loopbackAuthenticate('https://example.com',{home,notify:()=>{},open:async raw=>{
   const url=new URL(raw);challenge=url.searchParams.get('code_challenge')!;callback=url.searchParams.get('redirect_uri')!;
   assert.equal(new URL(callback).hostname,'127.0.0.1');
   const wrong=await fetch(callback+'?code=wrong&state=wrong');assert.equal(wrong.status,400);assert.equal(await loadConnection(undefined,home,{}),null);
   const accepted=await fetch(callback+'?code=approved&state='+url.searchParams.get('state'));assert.equal(accepted.status,200);
  },fetch:async(input,init)=>{
   const body=JSON.parse(String(init?.body));
   if(String(input).endsWith('/oauth/register'))return Response.json({client_id:'afbin_client'},{status:201});
   exchanges++;assert.equal(body.code,'approved');assert.equal(body.redirect_uri,callback);assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),challenge);assert.equal(body.resource,'https://example.com/api');
   return Response.json({access_token:'access',refresh_token:'refresh',expires_in:3600});
  }});
  assert.equal(exchanges,1);assert.equal(connection.token,'access');assert.deepEqual(await loadConnection(undefined,home,{}),connection);
 }finally{await rm(home,{recursive:true,force:true});}
});
