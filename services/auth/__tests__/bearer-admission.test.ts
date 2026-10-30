import {afterAll,beforeEach,expect,it} from 'vitest';
import {Hono} from 'hono';
import {actorOf,attachActor} from '@artifactbin/utils';
import {bearerAdmission,createAuthHost} from '../src/parts';
import {createOAuthStore} from '../src/identity/oauth';
import {mintTestToken,resetTestDb,testAuthOptions,testDb} from './helpers';

beforeEach(resetTestDb);
afterAll(async()=>{await testDb().pg().close();});
it('admits app-only API and artifact exports through the owner and refuses revoked or foreign credentials',async()=>{
 const options=await testAuthOptions({env:{APP__PUBLIC_BASE_URL:'http://app.test'}});
 const token=await mintTestToken({id:'app-only',userId:'owner',query:testDb().query});
 await testDb().query("UPDATE tokens SET audience='http://app.test/api',scope='artifacts' WHERE id='app-only'");
 const store=createOAuthStore({query:testDb().query},'auth');
 const refresh=await store.issueRefresh({clientId:'client',userId:'owner',resource:'http://app.test/api',scope:'artifacts',accessTokenId:'app-only'});
 const app=new Hono();bearerAdmission(options).mount(app);
 app.all('*',c=>Response.json(actorOf(c.req.raw)??{credential:'none'}));
 const headers={authorization:`Bearer ${token}`};
 const full=createAuthHost({...options,upstream:async(_request,actor)=>Response.json(actor)});
 for(const path of ['/a/abcdef/download','/a/abcdef/export'])expect(await(await full.request('http://app.test'+path,{headers})).json()).toMatchObject({credential:'bearer',userId:'owner'});
 for(const path of ['/api/artifacts','/api/artifacts/abc/query','/a/abcdef/download','/a/abcdef/export']){
  expect(await(await app.request('http://app.test'+path,{headers})).json()).toMatchObject({credential:'bearer',userId:'owner',tokenId:'app-only'});
 }
 await testDb().query("UPDATE tokens SET audience='http://foreign.test/api' WHERE id='app-only'");
 expect(await(await app.request('http://app.test/a/abcdef/export',{headers})).json()).toMatchObject({credential:'none'});
 await testDb().query("UPDATE tokens SET audience='http://app.test/api' WHERE id='app-only'");
 expect(await(await app.request('http://app.test/settings',{headers})).json()).toMatchObject({credential:'none'});
 const refused=attachActor(new Request('http://app.test/api/artifacts',{headers}),{credential:'none'});
 expect(await(await app.request(refused)).json()).toMatchObject({credential:'none'});
 await testDb().query("UPDATE tokens SET scope='other' WHERE id='app-only'");
 expect(await(await app.request('http://app.test/a/abcdef/export',{headers})).json()).toMatchObject({credential:'none'});
 await testDb().query("UPDATE tokens SET scope='artifacts' WHERE id='app-only'");
 await store.revokeRefresh(refresh,'client');
 for(const host of [app,full])for(const path of ['/api/artifacts','/a/abcdef/export','/a/abcdef/download'])expect(await(await host.request('http://app.test'+path,{headers})).json()).toMatchObject({credential:'none'});
});
