/** A page published with a file bundle, then opened on its own pages origin as its owner (ticket, cookie): bundle-links and
 * script-fetch-files; `openPage` is the open step alone, for a test that opens the page as several people. */
import {expect} from 'vitest';
import {mintAccountToken,request,testIdentity,testPagesSite} from '@/__tests__/harness';
import {POST} from '@/app/api/artifacts/route';

export async function publishBundleAndOpen(keyPrefix:string,sessionPrefix:string,visibility:'unlisted'|'private',name:string,html:string,publicationBundle:{entryPath:string;files:unknown[]}){
 const {createUser}=await import('@/lib/accounts');
 const {setServices}=await import('@/lib/platform');
 const {pagesOriginFor}=await import('@/lib/http');
 const {createAppServer}=await import('@/server/app');
 const user=await createUser({email:`mxmx_test_${name}@example.com`});const owner=await mintAccountToken(name,user.id);
 const response=await POST(request('/api/artifacts',{method:'POST',token:owner.token,headers:{'Idempotency-Key':`${keyPrefix}_${name}_0001`},json:{visibility,html,publicationBundle}}));
 const saved=await response.json() as {id:string;dependencyReceipts:{path:string;id:string}[]};
 expect(response.status,JSON.stringify(saved)).toBe(201);
 const site=testPagesSite('pages.example.test','https://app.example.test'),self=pagesOriginFor(saved.id,site);
 const app=createAppServer({indexHtml:async()=>'<html><body><div id="root"></div></body></html>',pagesSite:site});
 setServices({humanSessions:{live:async(id,userId)=>id===`${sessionPrefix}-${user.id}`&&userId===user.id}});
 const {opened,cookie:value}=await openPage(app,self,{...testIdentity('session',{userId:user.id,email:user.email}),sessionId:`${sessionPrefix}-${user.id}`},saved.id);expect(opened.status).toBe(200);
 const cookie='__Host-afbin_pages='+value!;
 return {app,self,owner,saved,cookie,served:await opened.text()};
}

/** Open the page at `self` with a pages ticket issued for `identity` (a session identity): the page's response and the
 * value of the `__Host-afbin_pages` cookie it set, if any. */
export async function openPage(app:{request(url:string):Response|Promise<Response>},self:string,identity:Parameters<typeof import('@/lib/accounts').issuePagesTicket>[0],artifactId:string){
 const {issuePagesTicket}=await import('@/lib/accounts');
 const ticket=await issuePagesTicket(identity,{},Date.now(),{artifactId,origin:self});
 const opened=await app.request(self+'/?_pt='+ticket);
 return {opened,cookie:/__Host-afbin_pages=([^;]+)/.exec(opened.headers.get('set-cookie')??'')?.[1]};
}
