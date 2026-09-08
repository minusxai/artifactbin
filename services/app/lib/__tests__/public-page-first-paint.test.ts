import {expect,it,vi} from 'vitest';
vi.mock('@/lib/config',async importOriginal=>({...await importOriginal<typeof import('@/lib/config')>(),PUBLIC_BASE_URL:'https://public.example.test',CONTROLS_ORIGIN:'https://i.public.example.test'}));
import {createAppServer} from '@/server/app';
import {attachActor} from '@artifactbin/utils';

it('serves meaningful public home HTML without waiting for a full-page iframe',async()=>{
  const app=createAppServer({indexHtml:async()=>'<html><head></head><body><div id="root"></div></body></html>'});
  const request=new Request('https://public.example.test/',{headers:{accept:'text/html'}});
  attachActor(request,{credential:'none'});
  const response=await app.fetch(request);
  expect(response.status).toBe(200);
  const html=await response.text();
  expect(html).not.toContain('Loading artifactbin');
  expect(html).toMatch(/<h1[\s>]/);
  expect(html).not.toContain('id="app-frame"');
});
