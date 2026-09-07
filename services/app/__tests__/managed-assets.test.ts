import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {withHttpServer,type RunningServer} from './net';
vi.mock('@/lib/config',async original=>({...await original<typeof import('@/lib/config')>(),ASSETS_ORIGIN:'https://assets.example.test'}));
import {useAppHarness,request} from './harness';
import {importWebAsset,importForDocument,refreshWebAsset,webAssetByHash} from '@/lib/web-assets';
import {setWebIngestPolicyForTests} from '@/lib/web-ingest/fetch';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as resolve} from '@/app/a/[id]/assets/route';
import {GET as bytes} from '@/app/assets/[hash]/route';
import {urlHash,assetUrlFor} from '@/lib/story/asset-url';
import {setDocAssetImportCapForTests} from '@/lib/auth';
import {setAssetByteQuotaForTests} from '@/lib/asset-quota';
import {createUser} from '@/lib/users';
const PNG=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,9,9,9,9]);
useAppHarness();
let web:string,server:RunningServer;const hits:string[]=[];let version=1;
beforeAll(async()=>{server=await withHttpServer((req,res)=>{hits.push(req.url??'');if(req.url==='/redirect'){res.writeHead(302,{location:'http://169.254.169.254/private'});res.end();return;}res.setHeader('content-type',req.url?.endsWith('.js')?'text/javascript':req.url==='/bad'?'text/html':'application/octet-stream');res.end(req.url?.endsWith('.png')?PNG:req.url==='/big.js'?Buffer.alloc(11000,65):req.url==='/bad'?'<html>bad</html>':`globalThis.bundle = ${version};`);});web=server.base;setWebIngestPolicyForTests({allowPrivate:true,allowHttp:true});});
afterAll(async()=>{setWebIngestPolicyForTests(null);await server.close();});
afterEach(()=>{version=1;setDocAssetImportCapForTests(null);setAssetByteQuotaForTests(null);});
it('imports bundled scripts without executing them, serves safe bytes and rejects cached kind confusion',async()=>{
 const token=await mintToken('assets');const by={tokenId:token.id,userId:null};
 const row=await importWebAsset(web+'/bundle.js',by,'script');expect(row.content_type).toBe('text/javascript');
 expect((globalThis as Record<string,unknown>).bundle).toBeUndefined();
 const res=await bytes(new Request('https://assets.example.test/assets/'+row.url_hash),{params:Promise.resolve({hash:row.url_hash})});
 expect(await res.text()).toBe('globalThis.bundle = 1;');expect(res.headers.get('content-security-policy')).toBe('sandbox');
 await expect(importWebAsset(web+'/bundle.js',by,'image')).rejects.toMatchObject({code:'unsupported_type'});
 await importWebAsset(web+'/binary',by,'binary');await expect(importWebAsset(web+'/binary',by,'script')).rejects.toMatchObject({code:'unsupported_type'});
});
it('generic GET can read existing typed cache entries without refetching',async()=>{
 const token=await mintToken('generic');const by={tokenId:token.id,userId:null};
 const row=await importWebAsset(web+'/typed.js',by,'script');hits.length=0;
 expect((await importWebAsset(web+'/typed.js',by,'binary')).object_key).toBe(row.object_key);expect(hits).toEqual([]);
 const image=await importWebAsset(web+'/typed.png',by,'image');hits.length=0;
 expect((await importWebAsset(web+'/typed.png',by,'binary')).object_key).toBe(image.object_key);expect(hits).toEqual([]);
});
it('generic-first imports preserve only safe typed MIME, never executable HTML',async()=>{
 const token=await mintToken('generic-first');const by={tokenId:token.id,userId:null};
 await importWebAsset(web+'/first.js',by,'binary');hits.length=0;
 expect((await importWebAsset(web+'/first.js',by,'script')).content_type).toBe('text/javascript');expect(hits).toEqual([]);
 await importWebAsset(web+'/first.png',by,'binary');hits.length=0;
 expect((await importWebAsset(web+'/first.png',by,'image')).content_type).toBe('image/png');expect(hits).toEqual([]);
 expect((await importWebAsset(web+'/bad',by,'binary')).content_type).toBe('application/octet-stream');
});
it('keeps MIME, size and redirect SSRF enforcement for scripts',async()=>{
 const token=await mintToken('assets');const by={tokenId:token.id,userId:null};
 for(const [path,code]of[['/bad','unsupported_type'],['/big.js','too_large'],['/redirect','forbidden_address']])await expect(importWebAsset(web+path,by,'script')).rejects.toMatchObject({code});
});
it('resolves explicit kind as an absolute asset-host JSON address, never an upstream redirect',async()=>{
 const token=await mintToken('assets');const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Asset</p>'}}));const id=(await made.json()).id;
 const url=web+'/route.js';const res=await resolve(request(`/a/${id}/assets?kind=script&u=${encodeURIComponent(url)}`,{headers:{accept:'application/json'}}),{params:Promise.resolve({id})});
 expect(res.status).toBe(200);expect(await res.json()).toEqual({url:'https://assets.example.test'+assetUrlFor(url,(await webAssetByHash(urlHash(url)))!)});
 expect(res.headers.get('access-control-allow-origin')).toBe('*');expect(res.headers.get('access-control-allow-credentials')).toBeNull();
 hits.length=0;
 const missing=await resolve(request(`/a/missing/assets?kind=script&u=${encodeURIComponent(web+'/never.js')}`,{headers:{accept:'application/json'}}),{params:Promise.resolve({id:'missing'})});expect(missing.status).toBe(404);expect(hits).toEqual([]);
});
it('all import kinds share owner byte quota and document attempt allowance',async()=>{
 const token=await mintToken('quota');const doc={id:'budgetdoc',token_id:token.id,user_id:null};
 setDocAssetImportCapForTests(1);
 await importForDocument(doc,web+'/q.js','script');
 await importForDocument(doc,web+'/q.js','script');
 await expect(importForDocument(doc,web+'/q.bin','binary')).rejects.toMatchObject({code:'rate_limited'});
 setDocAssetImportCapForTests(null);setAssetByteQuotaForTests(1);hits.length=0;
 await expect(importForDocument(doc,web+'/over.bin','binary')).rejects.toMatchObject({code:'quota_exceeded'});expect(hits).toEqual([]);
});
it('never imports for unreadable private documents or imports private ref addresses',async()=>{
 const user=await createUser({email:'managed-assets-private@example.test'});const token=await mintToken('private',user.id);
 const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Private</p>'}}));const id=(await made.json()).id;
 hits.length=0;
 const res=await resolve(request(`/a/${id}/assets?kind=script&u=${encodeURIComponent(web+'/private.js')}`,{headers:{accept:'application/json'}}),{params:Promise.resolve({id})});expect(res.status).toBe(404);expect(hits).toEqual([]);
 await expect(importWebAsset('ref:'+id,{tokenId:token.id,userId:user.id},'binary')).rejects.toMatchObject({code:'forbidden_scheme'});
});
it('bounds account-only document imports without requiring a token',async()=>{
 const user=await createUser({email:'managed-account-only@example.test'});
 const doc={id:'accountdoc',token_id:null,user_id:user.id};
 setAssetByteQuotaForTests(1);
 await importForDocument(doc,web+'/account.js','script');
 hits.length=0;
 await importForDocument(doc,web+'/account.js','script');expect(hits).toEqual([]);
 await expect(importForDocument(doc,web+'/account.bin','binary')).rejects.toMatchObject({code:'quota_exceeded'});
 expect(hits).toEqual([]);
});
it('versions managed URLs after refresh so immutable script caches do not stay stale',async()=>{
 const token=await mintToken('versioned');const doc={id:'versions',token_id:token.id,user_id:null},url=web+'/version.js';
 const first=await importForDocument(doc,url,'script');version=2;
 await refreshWebAsset(url,{tokenId:token.id,userId:null},'script');
 const second=await importForDocument(doc,url,'script');
 expect(second).not.toBe(first);expect(first).toMatch(/\?v=[a-f0-9]{8}$/);expect(second).toMatch(/\?v=[a-f0-9]{8}$/);
});
