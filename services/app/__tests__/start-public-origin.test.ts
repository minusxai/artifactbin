import {expect,it,vi} from 'vitest';
vi.mock('@/lib/config',async original=>({
  ...await original<typeof import('@/lib/config')>(),
  get PUBLIC_BASE_URL(){return 'https://example.test';},
}));
import {attachActor} from '@artifactbin/utils';
import {POST} from '@/app/api/start/route';
import {POST as mint} from '@/app/api/tokens/anonymous/route';
import {baseUrl,unauthorized} from '@/lib/http';
import {createUser} from '@/lib/users';
import {anonymousPaste,ownedPaste} from '@/lib/agent-copy';
import {agentContract} from '@/lib/agent-contract';
import {useAppHarness} from './harness';
useAppHarness();

it('creates on main with public links for the user and agent',async()=>{
  const request=attachActor(new Request('https://example.test/api/start',{
    method:'POST',headers:{origin:'https://example.test','x-artifactbin-csrf':'1'},
  }),{credential:'none'});
  const response=await POST(request);
  expect(response.status).toBe(201);
  const body=await response.json();
  expect(new URL(body.url).origin).toBe('https://example.test');
  expect(body.prompt).toBe(anonymousPaste('https://example.test',body.id,body.token));
});
it('uses the resolved account for owned prompts even outside ambient request scope',async()=>{
  const user=await createUser({email:'mxmx_test_start_owned@example.com'});
  const request=attachActor(new Request('https://example.test/api/start',{method:'POST'}),{credential:'session',userId:user.id});
  const response=await POST(request);expect(response.status).toBe(201);
  const body=await response.json();
  expect(body.prompt).toBe(ownedPaste('https://example.test',body.id));
  expect(body.token).toBeUndefined();
});
it('keeps recovery links and minted agent instructions on the addressed main host',async()=>{
  const request=attachActor(new Request('https://example.test/api/tokens/anonymous',{method:'POST'}),{credential:'none'});
  expect(baseUrl(request)).toBe('https://example.test');
  const refused=await unauthorized(request).json();
  expect(refused.docs).toBe('https://example.test/docs');
  expect(refused.tokens).toBe('https://example.test/tokens/new');
  const minted=await (await mint(request)).json();
  expect(minted.note).toBe(agentContract('https://example.test','http'));
});
