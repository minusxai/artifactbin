import { expect, it, vi } from 'vitest';
vi.mock('@/lib/config', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/config')>(),
  get PUBLIC_BASE_URL(){return 'http://localhost:3000';}, CONTROLS_ORIGIN: 'http://i.localhost:3000',
}));
import { createAppServer } from '../app';
import { attachActor, signActor } from '@artifactbin/utils';
import { ACTOR_HEADER } from '@artifactbin/contracts';
import { useAppHarness,request } from '@/__tests__/harness';
import {createUser,ensureUsername,claimToken} from '@/lib/users';
import {mintToken} from '@/lib/tokens';
import {POST as createArtifact} from '@/app/api/artifacts/route';
useAppHarness();
const main = 'http://localhost:3000', controls = 'http://i.localhost:3000';
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head></head><body><div id="root"></div><span>Trusted SPA</span></body></html>' });
const throughProxy = (url: string) => app.fetch(attachActor(new Request(url), { credential: 'none' }));
it('refuses direct app access when the controls boundary is enabled', async () => {
  for (const origin of [main, controls]) {
    for (const path of ['/login', '/api/page/session', '/api/my/artifacts']) {
      const res = await app.request(origin + path);
      expect(res.status, origin + path).toBe(403);
      expect(await res.json()).toEqual({ error: 'proxy_required' });
    }
  }
  const split = createAppServer({ actorSecret: 'transport-secret', indexHtml: async () => '<head></head>' });
  expect((await split.request(controls + '/login', { headers: { [ACTOR_HEADER]: 'forged' } })).status).toBe(403);
  expect((await split.request(controls + '/controls/page/login', { headers: { [ACTOR_HEADER]: signActor({ credential: 'none' }, 'transport-secret') } })).status).toBe(404);
});
it('keeps first-party addresses on main with a direct validated app bootstrap', async () => {
  for (const path of ['/login?callbackUrl=%2Fa%2Fabc123', '/account', '/tokens/new', '/trash', '/chat', '/datasets/new']) {
    const res = await throughProxy(main + path);
    expect(res.status, path).toBe(200);
    expect(res.headers.get('location'), path).toBeNull();
    const html = await res.text();
    expect(html, path).not.toContain('<iframe');
    expect(html, path).toContain('mx-page-data');
    expect(html, path).toContain('Trusted SPA');
    expect(res.headers.get('cache-control')).toContain('no-store');
  }
});
it('retires all frame document paths without creating an alternate trusted renderer', async () => {
  for (const path of ['/controls/page/','/controls/page/login','/controls/page/a/abc123','/controls/folder/abc123','/controls/region/follow?page=/@user','/controls/a/abc123','/controls/page//example.com']) {
    const response=await throughProxy(controls+path);
    expect(response.status,path).toBe(404);
    expect(await response.text()).not.toContain('mx-page-frame-config');
  }
});
it('renders public profile content on main without admitting pretty author addresses on controls',async()=>{
  const owner=await ensureUsername(await createUser({email:'mxmx_test_frame_profile@example.com'}));
  const path='/@'+owner.username;
  const root=await throughProxy(main+path);expect(root.status).toBe(200);const html=await root.text();expect(html).not.toContain('/controls/region/follow');expect(html).toContain(owner.username);expect(html).not.toContain('id="app-frame"');
  const frame=await throughProxy(controls+'/controls/page'+path);expect(frame.status).toBe(404);
  expect((await throughProxy(controls+'/controls/page'+path+'/Ab3xK9-title')).status).toBe(404);
});
it('serves an admitted folder directly but never discloses it to a stranger or a legacy frame',async()=>{
  const owner=await ensureUsername(await createUser({email:'mxmx_test_frame_folder@example.com'}));
  const {token}=await mintToken('folder');await claimToken(owner.id,token);
  const actor={credential:'session' as const,userId:owner.id};
  const created=await createArtifact(request('/api/artifacts',{method:'POST',token,json:{format:'folder',title:'Private folder title',visibility:'private'}}));
  expect(created.status).toBe(201);const folder=await created.json();
  const fetch=(url:string)=>app.fetch(attachActor(new Request(url,{headers:{accept:'text/html'}}),actor));
  const response=await fetch(main+'/a/'+folder.id);const target=response.headers.get('location');
  const parent=target?await fetch(new URL(target,main).href):response;
  const html=await parent.text();expect(html).not.toContain('/controls/folder/');expect(html).toContain('Private folder title');expect(html).toContain('mx-page-data');expect(parent.headers.get('cache-control')).toContain('no-store');
  const frame=await fetch(controls+'/controls/folder/'+folder.id);expect(frame.status).toBe(404);
  const doc=await createArtifact(request('/api/artifacts',{method:'POST',token,json:{markup:'<h1>Never trusted</h1>'}}));
  const {id}=await doc.json();expect((await fetch(controls+'/controls/folder/'+id)).status).toBe(404);
  expect((await throughProxy(controls+'/controls/folder/'+folder.id)).status).toBe(404);
  const denied=await throughProxy(main+'/a/'+folder.id);expect(denied.status).toBe(404);expect(await denied.text()).not.toContain('Private folder title');
});
