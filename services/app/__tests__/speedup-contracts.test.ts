import {observedRequest} from '@/__tests__/conditional-request';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { useAppHarness, request } from './harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { PUT as replaceArtifact } from '@/app/api/artifacts/[id]/route';
import { getArtifactById } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import { mintToken } from '@/lib/tokens';
import { compileParsedArtifactMetadata, readParsedArtifactMetadata } from '@/lib/story/parsed-artifact-metadata';
import { createDatasetResultCache } from '@/lib/datasets/result-cache';
import type { CatalogResult } from '@/lib/datasets/execute';

useAppHarness();
const source = '<Helmet><Value name="choice" type="string" default="one"/><Query name="a">{`select 1 as n`}</Query><Query name="b">{`select * from a`}</Query></Helmet><p>Hello</p>';
const result = (n: number): CatalogResult => ({ rows: [{ n }], columns: [{ name: 'n', type: 'number' }], refreshedAt: new Date().toISOString() });

it('create and full replace persist a manifest of the exact final stamped source', async () => {
  const token = await mintToken('manifest');
  const response = await createArtifact(request('/api/artifacts', {method:'POST',token:token.token,json:{markup:source}}));
  expect(response.status).toBe(201);
  const {id} = await response.json();
  for (let pass=0;pass<2;pass++) {
    if(pass) expect((await replaceArtifact(await observedRequest(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{markup:source.replace('Hello','Updated')}}),{params:Promise.resolve({id})})).status).toBe(200);
    const row = (await getArtifactById(id))!;
    expect(row.source).toMatch(/id="/);
    expect(row.meta.parsedArtifact).toEqual(compileParsedArtifactMetadata(row.source!));
    expect(readParsedArtifactMetadata(row.meta,row.source!).sourceHash).toBe(createHash('sha256').update(row.source!).digest('hex'));
  }
});

it('malformed, missing and stale manifest data is reconstructed from canonical source', () => {
  const expected=compileParsedArtifactMetadata(source);
  for(const parsedArtifact of [null,{...expected,schemaVersion:999},{...expected,flow:{values:'bad'}},{...expected,sourceHash:'stale'},{...expected,compilerRevision:'old'}]) {
    expect(readParsedArtifactMetadata({parsedArtifact},source)).toEqual(expected);
  }
  expect(expected.queryDependencies.b).toContain('a');
  expect(readParsedArtifactMetadata({},source.replace('Hello','Different')).sourceHash).not.toBe(expected.sourceHash);
});

it('independent cache owners coalesce work and fresh owners reuse a completed database result', async () => {
  const db=await getDb(),a=createDatasetResultCache(db),b=createDatasetResultCache(db);
  let calls=0;
  const load=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,40));return result(7);};
  const req={ttlSeconds:60,authorize:async()=>{}};
  const outputs=await Promise.all([a.run('shared-seed',load,req),b.run('shared-seed',load,req)]);
  expect(calls).toBe(1);expect(outputs[0]).toEqual(outputs[1]);
  await createDatasetResultCache(db).run('shared-seed',load,req);expect(calls).toBe(1);
});

it('authorization failures cannot hit an existing result or be swallowed as cache failures', async () => {
  const cache=createDatasetResultCache(await getDb());let allowed=true,calls=0;
  const req={ttlSeconds:60,authorize:async()=>{if(!allowed)throw new Error('revoked');}};
  const load=async()=>{calls++;return result(1);};
  await cache.run('acl-seed',load,req);allowed=false;
  await expect(cache.run('acl-seed',load,req)).rejects.toThrow('revoked');expect(calls).toBe(1);
});

it('zero TTL bypasses retention and a failed fill does not poison future work', async () => {
  const cache=createDatasetResultCache(await getDb());let calls=0;
  const req={ttlSeconds:0,authorize:async()=>{}};
  await cache.run('zero-seed',async()=>result(++calls),req);
  await cache.run('zero-seed',async()=>result(++calls),req);expect(calls).toBe(2);
  await expect(cache.run('error-seed',async()=>{throw new Error('upstream');},{...req,ttlSeconds:60})).rejects.toThrow('upstream');
  expect((await cache.run('error-seed',async()=>result(9),{...req,ttlSeconds:60})).rows).toEqual([{n:9}]);
});
