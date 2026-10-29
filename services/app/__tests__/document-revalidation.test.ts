/** Native document validators preserve private reader isolation, ACLs, conditional reads and compression. */
import zlib from 'node:zlib';
import {nativeResponseIdentity} from './native-response-identity';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {attachActor} from '@artifactbin/utils';
import type {Actor} from '@artifactbin/contracts';
import {useAppHarness,request,setSession,mintAccountToken} from './harness';
import {observedRequest} from './conditional-request';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {PUT as putRoute} from '@/app/api/artifacts/[id]/route';
import {GET as artifactPage} from '@/app/api/page/artifact/[id]/route';
import { createUser } from '@/lib/accounts';
import {pagesOriginFor,pagesSiteFor} from '@/lib/http/pages-origin';
import { getDb, measureQueries } from '@/lib/platform';
import { mintExportKey } from '@/lib/export';
import * as native from '@/lib/document-serving/native-html.server';
import {createAppServer} from '../server/app';
useAppHarness();afterEach(()=>{setSession(null);vi.restoreAllMocks();});
const APP='https://app.example.test',site=pagesSiteFor('pages.example.test',APP)!;
const app=createAppServer({indexHtml:async()=>'<html><head></head><body><div id="root"></div></body></html>',pagesSite:site});
const BODY='<html><head><title>A plan</title></head><body><h1>A plan</h1>'+Array.from({length:40},()=>'<p>The quick brown fox jumps over the lazy dog, and then does it again for good measure.</p>').join('')+'</body></html>';
const read=(id:string,headers:Record<string,string>={},init:RequestInit={})=>app.request(`${pagesOriginFor(id,site)}/`,{headers:{accept:'text/html',...headers},...init});
const tagOf=(response:Response)=>response.headers.get('etag')!;
async function world(visibility='public'){
 const user=await createUser({email:`mxmx_test_reval_${Math.random().toString(36).slice(2,8)}@example.com`});const token=await mintAccountToken('reval',user.id);
 const actor:Actor={credential:'session',userId:user.id,email:user.email!,emailVerified:true};
 const result=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{html:BODY,visibility}}));expect(result.status,await result.clone().text()).toBe(201);const {id}=await result.json();
 const edit=async(html:string)=>{const result=await putRoute(await observedRequest(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{html}}),{params:Promise.resolve({id})});expect(result.status,await result.clone().text()).toBe(200);};
 return {id:id as string,user,token,actor,edit};
}
const as=(url:string,actor:Actor)=>attachActor(new Request(url,{headers:{accept:'text/html'}}),actor);
async function frameSrc(id:string,actor:Actor){const page=await app.request(as(`${APP}/a/${id}`,actor));return /<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;','&');}
async function pagesCookie(id:string,actor:Actor){const exchanged=await app.request(await frameSrc(id,actor));return /(__Host-afbin_pages=[^;]+)/.exec(exchanged.headers.get('set-cookie')??'')?.[1]??'';}
const nodes=(id:string,user:{id:string;email:string|null}|null,headers:Record<string,string>={},part='nodes')=>{setSession(user?{user:{id:user.id,email:user.email!}}:null);return artifactPage(request(`/api/page/artifact/${id}?part=${part}`,{headers}),{params:Promise.resolve({id})});};
describe('native document conditional reads',()=>{
 it('returns a weak private validator and an empty 304 without assembling the document',async()=>{
  const w=await world(),first=await read(w.id),tag=tagOf(first);expect(first.status).toBe(200);expect(tag).toMatch(/^W\/"[A-Za-z0-9_-]{22}"$/);expect(first.headers.get('cache-control')).toBe('private, no-cache');expect(await first.text()).toContain('A plan');
  const rendered=vi.spyOn(native,'nativeHtmlDocument');const again=await read(w.id,{'if-none-match':tag});expect(again.status).toBe(304);expect(await again.text()).toBe('');expect(tagOf(again)).toBe(tag);expect(rendered).not.toHaveBeenCalled();
 });
 it('answers a matching validator without fetching source or document columns',async()=>{
  const w=await world(),tag=tagOf(await read(w.id)),db=await getDb(),query=db.query.bind(db),rows:unknown[]=[];
  vi.spyOn(db,'query').mockImplementation(async(sql:string,params?:unknown[])=>{const result=await query(sql,params);rows.push(...result.rows);return result;});
  expect((await read(w.id,{'if-none-match':tag})).status).toBe(304);expect(rows.length).toBeGreaterThan(0);expect(rows.some(row=>row&&typeof row==='object'&&(Object.hasOwn(row,'source')||Object.hasOwn(row,'document')))).toBe(false);
 });
 it('does not spend more database queries revalidating than serving a full page',async()=>{const w=await world(),tag=tagOf(await read(w.id));const full=await measureQueries(async()=>{await (await read(w.id)).text();});const conditional=await measureQueries(async()=>{expect((await read(w.id,{'if-none-match':tag})).status).toBe(304);});expect(conditional.stats.count).toBeLessThanOrEqual(full.stats.count);expect(conditional.stats.count).toBeLessThan(25);});
 it('changes only the admitted platform nonce for an unchanged semantic validator',async()=>{const w=await world(),first=await read(w.id),tag=tagOf(first),html=await first.text(),miss=await read(w.id,{'if-none-match':'"different-page"'});expect(miss.status).toBe(200);expect(tagOf(miss)).toBe(tag);const before=nativeResponseIdentity(html),after=nativeResponseIdentity(await miss.text());expect(after.nonce).not.toBe(before.nonce);expect(after.html).toBe(before.html);});
 it('answers HEAD with the same validator and no body',async()=>{const w=await world(),first=await read(w.id),head=await read(w.id,{}, {method:'HEAD'});expect(head.status).toBe(200);expect(tagOf(head)).toBe(tagOf(first));expect(await head.text()).toBe('');});
 it.each(['*','weak','strong','list'])('accepts a matching %s conditional validator',async(kind)=>{const w=await world(),tag=tagOf(await read(w.id));const asked=kind==='*'?'*':kind==='weak'?tag:kind==='strong'?tag.slice(2):`"other", ${tag}`;expect((await read(w.id,{'if-none-match':asked})).status).toBe(304);});
 it('invalidates the source validator after a conditional native HTML replacement',async()=>{const w=await world(),tag=tagOf(await read(w.id));await w.edit(BODY.replace('A plan</h1>','An updated plan</h1>'));const fresh=await read(w.id,{'if-none-match':tag});expect(fresh.status).toBe(200);expect(tagOf(fresh)).not.toBe(tag);expect(await fresh.text()).toContain('An updated plan');expect((await read(w.id,{'if-none-match':tagOf(fresh)})).status).toBe(304);});
 it('includes authored initial viewer state in the immutable representation',async()=>{const w=await world(),tag=tagOf(await read(w.id));await w.edit(BODY.replace('</head>','<script type="application/json" data-af="state">{"tab":"details"}</script></head>'));const fresh=await read(w.id,{'if-none-match':tag});expect(fresh.status).toBe(200);expect(tagOf(fresh)).not.toBe(tag);expect(await fresh.text()).toContain('"initialState":{"tab":"details"}');});
 it('separates another signed-in reader from the owner and anonymous reader',async()=>{const w=await world(),other=await createUser({email:'mxmx_test_reval_other@example.com'});const owner=await read(w.id,{cookie:await pagesCookie(w.id,w.actor)}),stranger=await read(w.id,{cookie:await pagesCookie(w.id,{credential:'session',userId:other.id,email:other.email!})}),guest=await read(w.id);expect(new Set([tagOf(owner),tagOf(stranger),tagOf(guest)]).size).toBe(3);});
 it('does not let an owner validator open a private page to an anonymous reader',async()=>{const w=await world('private'),owner=await read(w.id,{cookie:await pagesCookie(w.id,w.actor)});expect(owner.status).toBe(200);const guest=await read(w.id,{'if-none-match':tagOf(owner)});expect(guest.status).toBe(404);expect(tagOf(guest)).toBeNull();});
 it('rechecks current read access before accepting an old public validator',async()=>{const w=await world(),tag=tagOf(await read(w.id));await (await getDb()).query("UPDATE artifacts SET visibility='private',sharing_revision=sharing_revision+1 WHERE id=$1",[w.id]);expect((await read(w.id,{'if-none-match':tag})).status).toBe(404);});
 it('does not cache exporter captures under a normal reader validator',async()=>{const w=await world(),capture=await app.request(`${pagesOriginFor(w.id,site)}/?chrome=0&key=${encodeURIComponent(mintExportKey(w.id))}`);expect(capture.status).toBe(200);expect(capture.headers.get('etag')).toBeNull();expect(capture.headers.get('cache-control')).toBe('no-store');});
 it('compresses native HTML while preserving its weak semantic validator',async()=>{const w=await world(),plain=await read(w.id),identity=await plain.text(),br=await read(w.id,{'accept-encoding':'gzip, br'});expect(br.headers.get('content-encoding')).toBe('br');expect(br.headers.get('vary')).toMatch(/Accept-Encoding/i);const wire=Buffer.from(await br.arrayBuffer());expect(wire.byteLength).toBeLessThan(identity.length/3);const compressed=nativeResponseIdentity(zlib.brotliDecompressSync(wire).toString()),uncompressed=nativeResponseIdentity(identity);expect(compressed.nonce).not.toBe(uncompressed.nonce);expect(compressed.html).toBe(uncompressed.html);expect(tagOf(br)).toBe(tagOf(plain));for(const tag of [tagOf(br),tagOf(plain)]){const again=await read(w.id,{'accept-encoding':'br','if-none-match':tag});expect(again.status).toBe(304);expect(again.headers.get('content-encoding')).toBeNull();expect(tagOf(again)).toBe(tag);}});
 it('uses identity when Brotli is refused or only gzip is accepted',async()=>{const w=await world();for(const accept of ['gzip','br;q=0, gzip','identity'])expect((await read(w.id,{'accept-encoding':accept})).headers.get('content-encoding')).toBeNull();});
 it('revalidates the retained nodes door and invalidates it after an edit',async()=>{const w=await world('private'),first=await nodes(w.id,w.user),tag=tagOf(first);expect(first.status).toBe(200);expect((await nodes(w.id,w.user,{'if-none-match':tag})).status).toBe(304);await w.edit(BODY.replace('A plan</h1>','Updated</h1>'));const fresh=await nodes(w.id,w.user,{'if-none-match':tag});expect(fresh.status).toBe(200);expect(tagOf(fresh)).not.toBe(tag);});
 it('does not let conditional headers bypass nodes ACLs or restore the retired editor',async()=>{const w=await world('private'),tag=tagOf(await nodes(w.id,w.user)),other=await createUser({email:'mxmx_test_reval_no_access@example.com'});expect((await nodes(w.id,other,{'if-none-match':tag})).status).toBe(404);expect((await nodes(w.id,null,{'if-none-match':tag})).status).toBe(404);expect((await nodes(w.id,w.user,{'if-none-match':tag},'editor')).status).toBe(404);});
});
