import {expect,it,vi} from 'vitest';
vi.mock('@/lib/config',async original=>({
  ...await original<typeof import('@/lib/config')>(),
  get PUBLIC_BASE_URL(){return 'https://example.test';},CONTROLS_ORIGIN:'https://i.example.test',
}));
import {attachActor} from '@artifactbin/utils';
import {POST} from '@/app/api/start/route';
import {POST as mint} from '@/app/api/tokens/anonymous/route';
import {baseUrl,unauthorized} from '@/lib/http';
import {createUser} from '@/lib/users';
import {ownedPaste} from '@/lib/agent-copy';
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
it('uses the resolved account for owned prompts even outside ambient request scope',async()=>{
  const user=await createUser({email:'mxmx_test_start_owned@example.com'});
  const request=attachActor(new Request('https://i.example.test/api/start',{method:'POST'}),{credential:'session',userId:user.id});
  const response=await POST(request);expect(response.status).toBe(201);
  const body=await response.json();
  expect(body.prompt).toBe(ownedPaste('https://example.test',body.id));
  expect(body.token).toBeUndefined();
});
it('keeps recovery links and minted agent instructions public without rewriting the addressed host',async()=>{
  const request=attachActor(new Request('https://i.example.test/api/tokens/anonymous',{method:'POST'}),{credential:'none'});
  expect(baseUrl(request)).toBe('https://i.example.test');
  const refused=await unauthorized(request).json();
  expect(refused.docs).toBe('https://example.test/docs');
  expect(refused.tokens).toBe('https://example.test/tokens/new');
  const minted=await (await mint(request)).json();
  expect(JSON.stringify(minted.note)).toContain('https://example.test');
  expect(JSON.stringify(minted.note)).not.toContain('https://i.example.test');
});
