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
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head></head><body>Trusted SPA</body></html>' });
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
  expect((await split.request(controls + '/controls/page/login', { headers: { [ACTOR_HEADER]: signActor({ credential: 'none' }, 'transport-secret') } })).status).toBe(200);
});
it('returns old controls-host page bookmarks to main, keeping APIs on controls', async () => {
  for (const path of ['/login', '/account', '/tokens/new', '/']) {
    const res = await throughProxy(controls + path+'?selection=kept');
    expect(res.status, path).toBe(302);
    expect(res.headers.get('location')).toBe(main+path+'?selection=kept');
  }
  expect((await throughProxy(controls + '/api/page/session')).status).toBe(200);
});
it('dedicates a frameable controls path without serving author document routes there', async () => {
  const res = await throughProxy(controls + '/controls/a/abc123');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('mx-controls-config');
  expect(res.headers.get('content-security-policy')).toContain(`frame-ancestors ${main}`);
  expect((await throughProxy(controls + '/a/abc123')).status).toBe(404);
});
it('keeps first-party app addresses on main with a credential-free trusted page frame', async () => {
  for (const path of ['/', '/login?callbackUrl=%2Fa%2Fabc123', '/account', '/tokens/new', '/trash', '/chat', '/datasets/new']) {
    const res = await throughProxy(main + path);
    expect(res.status, path).toBe(200);
    expect(res.headers.get('location'), path).toBeNull();
    const html = await res.text();
    expect(html, path).toContain('<iframe');
    expect(html, path).toContain(`${controls}/controls/page`);
    expect(html, path).not.toContain('Trusted SPA');
    expect(res.headers.get('cache-control')).toContain('no-store');
  }
});
it('frames only platform app pages, never author documents or arbitrary proxy destinations', async () => {
  for (const path of ['/', '/login', '/account', '/tokens/new']) {
    const res = await throughProxy(controls + '/controls/page' + path);
    expect(res.status, path).toBe(200);
    expect(await res.text()).toContain('Trusted SPA');
    expect(res.headers.get('content-security-policy')).toContain(`frame-ancestors ${main}`);
    expect(res.headers.get('cache-control')).toContain('no-store');
  }
  for (const path of ['/a/abc123', '/@someone/abc123-title', '/api/my/tokens', '//example.com', '/assets/ref/abc']) {
    const res = await throughProxy(controls + '/controls/page' + path);
    expect(res.status, path).toBe(404);
  }
});
it('frames public profile roots without admitting pretty author addresses',async()=>{
  const owner=await ensureUsername(await createUser({email:'mxmx_test_frame_profile@example.com'}));
  const path='/@'+owner.username;
  const root=await throughProxy(main+path);expect(root.status).toBe(200);expect(await root.text()).toContain('<iframe');
  const frame=await throughProxy(controls+'/controls/page'+path);expect(frame.status).toBe(200);expect(await frame.text()).toContain('Trusted SPA');
  expect((await throughProxy(controls+'/controls/page'+path+'/Ab3xK9-title')).status).toBe(404);
});
it('admits folders through a folder-only frame but never markup or private data in the parent',async()=>{
  const owner=await ensureUsername(await createUser({email:'mxmx_test_frame_folder@example.com'}));
  const {token}=await mintToken('folder');await claimToken(owner.id,token);
  const actor={credential:'session' as const,userId:owner.id};
  const created=await createArtifact(request('/api/artifacts',{method:'POST',token,json:{format:'folder',title:'Private folder title',visibility:'private'}}));
  expect(created.status).toBe(201);const folder=await created.json();
  const fetch=(url:string)=>app.fetch(attachActor(new Request(url,{headers:{accept:'text/html'}}),actor));
  const response=await fetch(main+'/a/'+folder.id);const target=response.headers.get('location');
  const parent=target?await fetch(new URL(target,main).href):response;
  const html=await parent.text();expect(html).toContain('/controls/folder/'+folder.id);expect(html).not.toContain('Private folder title');expect(html).not.toContain('mx-page-data');
  const frame=await fetch(controls+'/controls/folder/'+folder.id);expect(frame.status).toBe(200);expect(await frame.text()).toContain('folderOnly');
  const doc=await createArtifact(request('/api/artifacts',{method:'POST',token,json:{markup:'<h1>Never trusted</h1>'}}));
  const {id}=await doc.json();expect((await fetch(controls+'/controls/folder/'+id)).status).toBe(404);
  expect((await throughProxy(controls+'/controls/folder/'+folder.id)).status).toBe(404);
});
