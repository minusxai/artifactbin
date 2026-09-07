import {expect,it,vi} from 'vitest';
vi.mock('@/lib/config',async original=>({
  ...await original<typeof import('@/lib/config')>(),
  PUBLIC_BASE_URL:'https://example.test',CONTROLS_ORIGIN:'https://i.example.test',
}));
import {attachActor} from '@artifactbin/utils';
import {POST} from '@/app/api/start/route';
import {useAppHarness} from './harness';
useAppHarness();

it('creates through the trusted host but gives the user and agent public document links',async()=>{
  const request=attachActor(new Request('https://i.example.test/api/start',{
    method:'POST',headers:{origin:'https://i.example.test','x-artifactbin-csrf':'1'},
  }),{credential:'none'});
  const response=await POST(request);
  expect(response.status).toBe(201);
  const body=await response.json();
  expect(new URL(body.url).origin).toBe('https://example.test');
  expect(body.prompt.includes('https://example.test/a/')).toBe(true);
  expect(body.prompt.includes('https://i.example.test/')).toBe(false);
});
