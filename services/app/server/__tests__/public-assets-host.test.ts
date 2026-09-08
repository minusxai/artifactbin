import {it,expect,vi} from 'vitest';
vi.mock('@/lib/config',async original=>({...await original<typeof import('@/lib/config')>(),get PUBLIC_BASE_URL(){return 'https://example.test';},ASSETS_ORIGIN:'https://assets.example.test'}));
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/db';
import {objectStore,objectKey} from '@/lib/object-store';
import {createAppServer} from '../app';
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
