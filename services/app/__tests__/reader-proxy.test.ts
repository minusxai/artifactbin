/** Reader URLs use the shared app document; explicit raw/export keeps its sandbox. */
import { pagesSite } from '@/lib/serving/pages-origin';
import { describe, expect, it } from 'vitest';
import { ACTOR_HEADER, type Actor } from '@artifactbin/contracts';
import { signActor } from '@artifactbin/utils';
import { BOOTSTRAP_ID, appPagePolicy, candidateDocument, createAppServer } from '@/server/app';
import { createArtifact } from '@/lib/artifacts';
import { mintToken } from '@/lib/accounts';
import { createUser, ensureUsername } from '@/lib/accounts';
import { agentCookie, useAppHarness } from './harness';
useAppHarness();
const secret='test-reader-actor-secret-000000000000';
const shell='<html><head><title>App</title></head><body><div id="root"></div></body></html>';
const app=createAppServer({actorSecret:secret,indexHtml:async()=>shell});
const actor=(value:Actor)=>({[ACTOR_HEADER]:signActor(value,secret)});
const publish=async(visibility:'public'|'unlisted'|'private'='public',source='<h1 id="heading">Readable body</h1>',userId:string|null=null)=>{
 const token=await mintToken('reader',userId);
 const row=await createArtifact(token.id,userId,{format:'markup',source,meta:{},title:'Document',description:null,visibility});
 return {token,row};
};
describe('reader delivery over HTTP',()=>{
 it('recognizes document addresses but not raw/API/profile-only paths',()=>{
  for(const path of ['/a/Ab3xK9','/@name/folder/Ab3xK9-title'])expect(candidateDocument(path)).toEqual({id:'Ab3xK9'});
  for(const path of ['/a/Ab3xK9/raw','/api/artifacts','/@name','/'])expect(candidateDocument(path)).toBeNull();
 });
 it.each(['public','unlisted'] as const)('serves %s readers the document\'s frame and prepared data under app CSP',async visibility=>{
  const {row}=await publish(visibility),response=await app.request(`/a/${row.id}`),html=await response.text();
  expect(response.status).toBe(200);expect(response.headers.get('content-security-policy')).toBe(appPagePolicy(pagesSite()));
  expect(response.headers.get('cache-control')).toBe('no-store');expect(html).toContain('data-mx-document-frame');
  expect(html).not.toContain('>Readable body</h1>');expect(html).toContain(BOOTSTRAP_ID);expect(html).not.toContain('<iframe title="artifact"');
 });
 it('serves anonymous owners the same document policy',async()=>{
  const {row,token}=await publish();const response=await app.request(`/a/${row.id}`,{headers:{cookie:await agentCookie([token.id])}});
  expect(response.status).toBe(200);expect(response.headers.get('content-security-policy')).toBe(appPagePolicy(pagesSite()));expect(await response.text()).toContain('"role":"owner"');
 });
 it('never leaks private contents or a canonical redirect to strangers',async()=>{
  const owner=await ensureUsername(await createUser({email:'mxmx_test_reader@example.com'}));const {row}=await publish('private','<p>Private-only words</p>',owner.id);
  for(const path of [`/a/${row.id}`,'/a/nope00']){const response=await app.request(path,{headers:{accept:'text/html'}});expect(response.status).toBe(404);expect(response.headers.get('location')).toBeNull();expect(await response.text()).not.toContain('Private-only words');}
 });
 it('heals private owner addresses only after read ACL and retains no-store',async()=>{
  const owner=await ensureUsername(await createUser({email:'mxmx_test_reader@example.com'}));const {row}=await publish('private','<p>Private owner body</p>',owner.id);
  // Served in place (no redirect hop), naming the canonical address the page heals to.
  const headers=actor({credential:'session',userId:owner.id,email:owner.email});const response=await app.request(`/a/${row.id}`,{headers});
  expect(response.status).toBe(200);expect(response.headers.get('location')).toBeNull();expect(response.headers.get('cache-control')).toBe('no-store');
  const html=await response.text();expect(html).toContain('data-mx-document-frame');expect(html).not.toContain('>Private owner body</p>');expect(html).toContain(`"address":"/@${owner.username}/${row.id}`);
 });
 it('retains raw sandbox without inheriting it into the app reader',async()=>{
  const {row}=await publish(),raw=await app.request(`/a/${row.id}/raw?chrome=0`),page=await app.request(`/a/${row.id}`);
  expect(raw.headers.get('content-security-policy')).toContain('sandbox');expect(page.headers.get('content-security-policy')).not.toContain('sandbox');expect(await raw.text()).toContain('Readable body');
 });
 it('keeps scripts inert and live selections in prepared data',async()=>{
  const {row}=await publish('public','<Helmet><Value name="count" type="number" default={0}/><script>{`globalThis.shouldNotRun=true`}</script></Helmet><p>{$count}</p>');
  const html=await(await app.request(`/a/${row.id}?$count=4`)).text();expect(html).toMatch(/"authorScript":"[^"]*globalThis\.shouldNotRun = true;/);expect(html).not.toContain('<script>globalThis.shouldNotRun');expect(html).not.toMatch(/<script(?![^>]*type="application\/json")[^>]*>[^<]*shouldNotRun/);expect(html).toContain('"values":{"count":4}');
 });
 it('keeps datasets on their existing app representation',async()=>{
  const token=await mintToken('dataset'),row=await createArtifact(token.id,null,{format:'dataset',source:null,meta:{},title:'Data',description:null,visibility:'public'});
  const response=await app.request(`/a/${row.id}`),html=await response.text();expect(response.status).toBe(200);expect(html).toContain('"format":"dataset"');expect(html).not.toContain('data-mx-initial-story');
 });
});
