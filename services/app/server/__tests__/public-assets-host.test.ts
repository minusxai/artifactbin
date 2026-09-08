import {it,expect,vi} from 'vitest';
vi.mock('@/lib/config',async original=>({...await original<typeof import('@/lib/config')>(),get PUBLIC_BASE_URL(){return 'https://example.test';},ASSETS_ORIGIN:'https://assets.example.test'}));
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/db';
import {objectStore,objectKey} from '@/lib/object-store';
import {createAppServer} from '../app';
import {mintToken} from '@/lib/tokens';
import {createArtifact} from '@/lib/artifacts';
import {storeFileContent} from '@/lib/story/file-store';
import {internalAssetResponse} from '../../../browser/src/internal-assets';
import {withHttpServer} from '@/__tests__/net';
import {getRequestListener} from '@hono/node-server';
useAppHarness();
it('direct app only serves cached byte GET/HEAD on asset host, ignoring credentials and forwarding spoofing',async()=>{
 const hash='a'.repeat(64),data=Buffer.from('bundle'),key=objectKey('webasset',data);
 await objectStore().put(key,data,'text/javascript');
 await(await getDb()).query('insert into web_assets(url_hash,url,object_key,content_type,bytes)values($1,$2,$3,$4,$5)',[hash,'https://cdn.example.test/x.js',key,'text/javascript',data.length]);
 const app=createAppServer({indexHtml:async()=>'<head></head>'}),host='https://assets.example.test';
 for(const method of ['GET','HEAD']){
  const res=await app.request(host+'/assets/'+hash,{method,headers:{cookie:'session=secret',authorization:'Bearer secret','x-forwarded-host':'i.example.test'}});
  expect(res.status).toBe(200);expect(await res.text()).toBe(method==='GET'?'bundle':'');expect(res.headers.get('set-cookie')).toBeNull();expect(res.headers.get('access-control-allow-origin')).toBe('*');
 }
 for(const [path,method]of[['/login','GET'],['/api/auth/get-session','GET'],['/a/abc123/resolve?ref=ref:abc123','GET'],['/assets/'+hash,'POST'],['/assets/'+hash+'?url=secret','GET']]){
  expect((await app.request(host+path,{method,headers:{'x-forwarded-host':'i.example.test'}})).status).toBe(404);
 }
});

it('reuses public ref bytes anonymously but never exposes a private ref, even with owner credentials',async()=>{
 const token=await mintToken('asset-host-ref'),bytes=Buffer.from([1,2,3]),stored=await storeFileContent(bytes,'model/gltf-binary','scene.glb');
 if(stored instanceof Response)throw new Error(await stored.text());
 const publicRow=await createArtifact(token.id,null,{...stored,title:'public',description:null,visibility:'public'}),privateRow=await createArtifact(token.id,null,{...stored,title:'private',description:null,visibility:'private'});
 const publicId=publicRow.id,privateId=privateRow.id,app=createAppServer({indexHtml:async()=>'<head></head>'}),host='https://assets.example.test';
 const first=await app.request(`${host}/assets/ref/${publicId}`,{headers:{authorization:`Bearer ${token.token}`,cookie:'session=secret'}});
 const second=await app.request(`${host}/assets/ref/${publicId}`);
 expect(first.status).toBe(200);expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([...bytes]);
 expect(second.status).toBe(200);expect(second.headers.get('cache-control')).toBe('no-store');
 await(await getDb()).query("UPDATE artifacts SET visibility = 'private' WHERE id = $1",[publicId]);
 expect((await app.request(`${host}/assets/ref/${publicId}`)).status).toBe(404);
 expect((await app.request(`${host}/assets/ref/${privateId}`,{headers:{authorization:`Bearer ${token.token}`,cookie:'session=secret'}})).status).toBe(404);
});

it('internal export transport reaches the real public-byte middleware, not the authenticated app routes',async()=>{
 const token=await mintToken('internal-asset-ref'),bytes=Buffer.from([3,2,1]),stored=await storeFileContent(bytes,'model/gltf-binary','scene.glb');
 if(stored instanceof Response)throw new Error(await stored.text());
 const publicRow=await createArtifact(token.id,null,{...stored,title:'public',description:null,visibility:'public'}),privateRow=await createArtifact(token.id,null,{...stored,title:'private',description:null,visibility:'private'});
 const hash='b'.repeat(64),key=objectKey('webasset',bytes);
 await objectStore().put(key,bytes,'application/octet-stream');
 await(await getDb()).query('insert into web_assets(url_hash,url,object_key,content_type,bytes)values($1,$2,$3,$4,$5)',[hash,'https://cdn.example.test/model',key,'application/octet-stream',bytes.length]);
 const app=createAppServer({indexHtml:async()=>'<head></head>'});
 const server=await withHttpServer(getRequestListener(app.fetch));
 const read=(path:string)=>internalAssetResponse('https://assets.example.test'+path,'GET','https://assets.example.test',server.base,AbortSignal.timeout(3000));
 try{
  for(const path of ['/assets/'+hash,'/assets/ref/'+publicRow.id]){
   const response=await read(path);expect(response.status).toBe(200);expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...bytes]);
   expect(response.headers.get('access-control-allow-origin')).toBe('*');expect(response.headers.get('content-security-policy')).toContain('sandbox');
  }
  expect((await read('/assets/ref/'+privateRow.id)).status).toBe(404);
  await(await getDb()).query("UPDATE artifacts SET visibility='private' WHERE id=$1",[publicRow.id]);
  expect((await read('/assets/ref/'+publicRow.id)).status).toBe(404);
 }finally{await server.close();}
});
