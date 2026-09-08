import {expect,it,vi} from 'vitest';
vi.mock('@/lib/config',async original=>({...await original<typeof import('@/lib/config')>(),get PUBLIC_BASE_URL(){return 'http://localhost:3000';},CONTROLS_ORIGIN:'http://i.localhost:3000'}));
import {useAppHarness,request} from './harness';
import {createAppServer} from '@/server/app';
import {attachActor} from '@artifactbin/utils';
import {createUser,ensureUsername,claimToken} from '@/lib/users';
import {mintToken} from '@/lib/tokens';
import {POST as createArtifact} from '@/app/api/artifacts/route';
useAppHarness();
it('renders the public profile and metadata without private rows/account bootstrap, including for its owner',async()=>{
  const owner=await ensureUsername(await createUser({email:'mxmx_test_public_ssr@example.com'}));
  const {token}=await mintToken('public profile');await claimToken(owner.id,token);
  for(const visibility of ['public','private'] as const){
    const response=await createArtifact(request('/api/artifacts',{method:'POST',token,json:{markup:'<p>Stored author source must not enter the public listing</p>',title:visibility==='public'?'Public card title':'Private card title',visibility}}));
    expect(response.status).toBe(201);
  }
  const app=createAppServer({indexHtml:async()=>'<html><head></head><body><div id="root"></div></body></html>'});
  for(const actor of [{credential:'none' as const},{credential:'session' as const,userId:owner.id}]){
    const response=await app.fetch(attachActor(new Request('http://localhost:3000/@'+owner.username),actor));
    expect(response.status).toBe(200);const html=await response.text();
    expect(html).toContain(`<title>@${owner.username} · artifactbin</title>`);
    expect(html).toContain('Public card title');expect(html).not.toContain('Private card title');
    expect(html).not.toContain(owner.email);expect(html).not.toContain('Stored author source');
    const bootstrap=JSON.parse(html.match(/id="mx-page-data">([\s\S]*?)<\/script>/)![1]);
    expect(bootstrap.session.kind).toBe(actor.credential==='session'?'account':'none');
    expect(bootstrap).not.toHaveProperty('home');expect(bootstrap).not.toHaveProperty('artifact');
    expect(response.headers.get('cache-control')).toContain('no-store');expect(html).not.toContain('id="app-frame"');
  }
  expect((await app.fetch(attachActor(new Request('http://localhost:3000/@mxmx_missing'),{credential:'none'}))).status).toBe(404);
});
