import {expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {GET as artifactPage} from '@/app/api/page/artifact/[id]/route';
import {mintToken} from '@/lib/tokens';

useAppHarness();

it('the markup page transports compiled CSS once and preserves editable source and runtime',async()=>{
  const token=await mintToken('payload');
  const create=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<h1>Readable content</h1>'}}));
  expect(create.status).toBe(201);const {id}=await create.json();
  const response=await artifactPage(request(`/api/page/artifact/${id}`,{token:token.token}),{params:Promise.resolve({id})});
  expect(response.status).toBe(200);
  const payload=await response.json();
  expect(payload.surface.runtime.compiledCss).toEqual(expect.any(String));
  expect(payload.surface).not.toHaveProperty('compiledCss');
  expect(payload.surface.source).toContain('Readable content');
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('dataset pages without an author runtime keep the existing CSS-shaped surface contract',async()=>{
  const token=await mintToken('dataset-payload');
  const create=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}]}}));
  expect(create.status).toBe(201);const {id}=await create.json();
  const response=await artifactPage(request(`/api/page/artifact/${id}`,{token:token.token}),{params:Promise.resolve({id})});
  expect(response.status).toBe(200);const payload=await response.json();
  expect(payload.surface.runtime).toBeUndefined();
  expect(payload.surface).toHaveProperty('compiledCss');
});
