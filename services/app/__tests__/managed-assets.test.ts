import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
vi.mock('@/lib/config',async original=>({...await original<typeof import('@/lib/config')>(),ASSETS_ORIGIN:'https://assets.example.test'}));
import {useAppHarness,request} from './harness';
import {importWebAsset,importForDocument} from '@/lib/web-assets';
import {setWebIngestPolicyForTests} from '@/lib/web-ingest/fetch';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as resolve} from '@/app/a/[id]/assets/route';
import {GET as bytes} from '@/app/assets/[hash]/route';
import {urlHash} from '@/lib/story/asset-url';
import {setDocAssetImportCapForTests} from '@/lib/auth';
import {setAssetByteQuotaForTests} from '@/lib/asset-quota';
import {createUser} from '@/lib/users';
useAppHarness();
const web='http://127.0.0.1:5620',hits:string[]=[];
const server=createServer((req,res)=>{hits.push(req.url??'');if(req.url==='/redirect'){res.writeHead(302,{location:'http://169.254.169.254/private'});res.end();return;}res.setHeader('content-type',req.url?.endsWith('.js')?'text/javascript':req.url==='/bad'?'text/html':'application/octet-stream');res.end(req.url==='/big.js'?Buffer.alloc(11000,65):req.url==='/bad'?'<html>bad</html>':'globalThis.bundle = 1;');});
beforeAll(async()=>{await new Promise<void>(r=>server.listen(5620,'127.0.0.1',r));setWebIngestPolicyForTests({allowPrivate:true,allowHttp:true});});
afterAll(async()=>{setWebIngestPolicyForTests(null);await new Promise<void>(r=>server.close(()=>r()));});
afterEach(()=>{setDocAssetImportCapForTests(null);setAssetByteQuotaForTests(null);});
it('imports bundled scripts without executing them, serves safe bytes and rejects cached kind confusion',async()=>{
 const token=await mintToken('assets');const by={tokenId:token.id,userId:null};
 const row=await importWebAsset(web+'/bundle.js',by,'script');expect(row.content_type).toBe('text/javascript');
 expect((globalThis as Record<string,unknown>).bundle).toBeUndefined();
 const res=await bytes(new Request('https://assets.example.test/assets/'+row.url_hash),{params:Promise.resolve({hash:row.url_hash})});
 expect(await res.text()).toBe('globalThis.bundle = 1;');expect(res.headers.get('content-security-policy')).toBe('sandbox');
 await expect(importWebAsset(web+'/bundle.js',by,'image')).rejects.toMatchObject({code:'unsupported_type'});
 await importWebAsset(web+'/binary',by,'binary');await expect(importWebAsset(web+'/binary',by,'script')).rejects.toMatchObject({code:'unsupported_type'});
});
it('keeps MIME, size and redirect SSRF enforcement for scripts',async()=>{
 const token=await mintToken('assets');const by={tokenId:token.id,userId:null};
 for(const [path,code]of[['/bad','unsupported_type'],['/big.js','too_large'],['/redirect','forbidden_address']])await expect(importWebAsset(web+path,by,'script')).rejects.toMatchObject({code});
});
it('resolves explicit kind as an absolute asset-host JSON address, never an upstream redirect',async()=>{
 const token=await mintToken('assets');const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Asset</p>'}}));const id=(await made.json()).id;
 const url=web+'/route.js';const res=await resolve(request(`/a/${id}/assets?kind=script&u=${encodeURIComponent(url)}`,{headers:{accept:'application/json'}}),{params:Promise.resolve({id})});
 expect(res.status).toBe(200);expect(await res.json()).toEqual({url:'https://assets.example.test/assets/'+urlHash(url)});
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
