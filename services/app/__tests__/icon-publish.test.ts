/** Native SVG replaces the retired platform Icon resolver and its alias vocabulary. */
import {describe,expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {nativeHtml} from './native-html-fixture';
import {observedRequest} from './conditional-request';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace} from '@/app/api/artifacts/[id]/route';
useAppHarness();
describe('native icon publication',()=>{
 it('preserves an authored accessible SVG and its identity',async()=>{
  const token=await mintAccountToken('svg');
  const html=nativeHtml('<svg data-af-id="calendar" role="img" aria-label="Calendar" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"></path></svg>');
  const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html}}));
  expect(response.status).toBe(201);const wire=await response.json();
  expect(wire.html).toContain('data-af-id="calendar"');expect(wire.html).toContain('aria-label="Calendar"');
  expect(wire.html).toContain('M4 4h16v16H4z');
 });
 it('refuses retired JSX icon publication without replacing native source',async()=>{
  const token=await mintAccountToken('svg');
  const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeHtml('<p>Keep</p>')}}));
  expect(response.status).toBe(201);const original=await response.json(),ctx={params:Promise.resolve({id:original.id})};
  const refused=await replace(await observedRequest(`/api/artifacts/${original.id}`,{method:'PUT',token:token.token,json:{markup:'<Icon name="calendar" />'}}),ctx);
  expect(refused.status).toBe(400);expect(await refused.json()).toMatchObject({error:'native_html_required'});
  const current=await read(request(`/api/artifacts/${original.id}`,{token:token.token}),ctx);
  expect(await current.json()).toMatchObject({html:original.html,version:original.version});
 });
});
