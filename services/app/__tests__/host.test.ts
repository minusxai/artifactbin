import {it,expect} from 'vitest';
import {useAppHarness} from './harness';
import {createAppHost} from '@/server/host';
import {localOwner} from '../../utils/src/local-owner';
import {mintToken,resolveToken} from '@/lib/tokens';

useAppHarness();
it.each([false,true])('assembles identity and an optional host document policy (grant=%s)',async(grant)=>{
 const origin='http://127.0.0.1:7451';let token='';
 const host=await createAppHost({documentEditorPolicy:grant?account=>account.userId==='usr_local':undefined,initialize:async db=>{
  await db.query("INSERT INTO users (id,email,name,username) VALUES ($1,$2,$3,$4)",['usr_local','local@self.invalid','Local owner','local']);
  token=(await mintToken('self','usr_local',db,{expiresInMs:null})).token;
 },identity:upstream=>localOwner({origin,instanceId:'self-test',ownerId:'usr_local',cookieSecret:'s'.repeat(64),upstream,
  resolveBearer:async offered=>{const found=await resolveToken(offered);return found?{credential:'bearer',userId:found.userId??undefined,tokenId:found.id}:null;}})});
 const created=await host.fetch(new Request(origin+'/api/artifacts',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({markup:'<p>Hello self</p>',visibility:'private'})}));
 expect(created.status).toBe(201);const artifact=await created.json();
 const owner=await host.fetch(new Request(origin+'/api/artifacts/'+artifact.id,{headers:{authorization:'Bearer '+token}}));
 expect(owner.status).toBe(200);expect((await owner.json()).markup).toContain('Hello self');
 const anonymous=await host.fetch(new Request(origin+'/api/artifacts/'+artifact.id));
 expect([401,404]).toContain(anonymous.status);
 const foreign=await host.request(new Request(origin+'/api/artifacts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({markup:'<p>Other owner</p>',visibility:'private'})}),{credential:'bearer',tokenId:'tok_other',userId:'usr_other'});
 expect(foreign.status).toBe(201);const other=await foreign.json();
 const access=await host.fetch(new Request(origin+'/api/artifacts/'+other.id,{headers:{authorization:'Bearer '+token}}));
 expect(access.status).toBe(grant?200:404);
});
