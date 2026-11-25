import {nativeHtml} from './native-html-fixture';
import {it,expect,onTestFinished,vi} from 'vitest';
import {getDb} from '@/lib/platform';
import {useAppHarness} from './harness';
import {createAppHost} from '@/server/host';
import {ANONYMOUS} from '@artifactbin/contracts/actor';
import { resolveToken } from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';

useAppHarness();
it.each([false,true])('assembles identity and an optional host document policy (grant=%s)',async(grant)=>{
 const origin='http://127.0.0.1:7451';let token='';
 const host=await createAppHost({ownsDatabase:false,documentEditorPolicy:grant?account=>account.userId==='usr_local':undefined,initialize:async db=>{
  await db.query("INSERT INTO users (id,email,name,username) VALUES ($1,$2,$3,$4)",['usr_local','local@self.invalid','Local owner','local']);
  token=(await mintToken('self','usr_local', {expiresInMs:null})).token;
 },identity:upstream=>({fetch:async request=>{
  // A bearer-only identity in front of the app: the host hands every request to it with the app as its upstream.
  const offered=/^Bearer (.+)$/.exec(request.headers.get('authorization')??'')?.[1];
  const found=offered?await resolveToken(offered):null;
  return upstream(request,found?{credential:'bearer',userId:found.userId??undefined,tokenId:found.id,email:'local@self.invalid',emailVerified:true}:ANONYMOUS);
 }})});
 onTestFinished(host.close);
 const created=await host.fetch(new Request(origin+'/api/artifacts',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({html: nativeHtml('<p>Hello self</p>'),visibility:'private'})}));
 expect(created.status).toBe(201);const artifact=await created.json();
 const owner=await host.fetch(new Request(origin+'/api/artifacts/'+artifact.id,{headers:{authorization:'Bearer '+token}}));
 expect(owner.status).toBe(200);expect((await owner.json()).html).toContain('Hello self');
 const anonymous=await host.fetch(new Request(origin+'/api/artifacts/'+artifact.id));
 expect([401,404]).toContain(anonymous.status);
 const otherToken=await mintToken('other','usr_other');
 const publishAsOther=async(visibility:'unlisted'|'private')=>{
  const made=await host.request(new Request(origin+'/api/artifacts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({html: nativeHtml('<p>Other owner</p>'),visibility})}),{credential:'bearer',tokenId:otherToken.id,userId:'usr_other',email:'other@self.invalid',emailVerified:true});
  expect(made.status).toBe(201);return (await made.json()).id as string;
 };
 // The host grant edits a foreign document a link could reach, and nothing private.
 const access=await host.fetch(new Request(origin+'/api/artifacts/'+await publishAsOther('unlisted'),{headers:{authorization:'Bearer '+token}}));
 expect(access.status).toBe(200);expect((await access.json()).capabilities).toMatchObject({edit:grant,delete:false});
 const hidden=await host.fetch(new Request(origin+'/api/artifacts/'+await publishAsOther('private'),{headers:{authorization:'Bearer '+token}}));
 expect(hidden.status).toBe(404);
});

it('awaits a failing audit projection during cleanup and leaves the harness database usable',async()=>{
 const db=await getDb();
 const projection=Promise.withResolvers<never>();
 const query=db.query.bind(db);
 const queries=vi.spyOn(db,'query').mockImplementation((sql,params)=>
  sql.includes('FROM host_tenancy_changes WHERE')?projection.promise:query(sql,params));
 const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
 onTestFinished(()=>{queries.mockRestore();errors.mockRestore();});
 const host=await createAppHost({ownsDatabase:false});
 onTestFinished(async()=>{
  projection.reject(new Error('test audit projection failure'));
  await host.close();
 });
 const closing=host.close();
 expect(host.close()).toBe(closing);
 const settled=vi.fn();
 void closing.then(settled,settled);
 await Promise.resolve();
 expect(settled).not.toHaveBeenCalled();
 projection.reject(new Error('test audit projection failure'));
 await closing;
 expect(errors).toHaveBeenCalledWith('[group audit] host tenancy projection failed, will retry');
 expect((await db.query('SELECT 1 AS alive')).rows).toEqual([{alive:1}]);
});
