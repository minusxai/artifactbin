import {observedRequest} from '@/__tests__/conditional-request';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { useAppHarness, request } from './harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { PUT as replaceArtifact } from '@/app/api/artifacts/[id]/route';
import { getArtifactById } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { readCompiledDataflow, storedCompiledDataflow } from '@/lib/story/parsed-artifact-metadata';
import { compiledSource } from '@/test/helpers/compiled';

useAppHarness();
const source = '<Helmet><Value name="choice" type="string" default="one"/><Query name="a">{`select 1 as n`}</Query><Query name="b">{`select * from a`}</Query></Helmet><p>Hello</p>';

it('create and full replace persist a manifest of the exact final stamped source', async () => {
  const token = await mintToken('manifest');
  const response = await createArtifact(request('/api/artifacts', {method:'POST',token:token.token,json:{markup:source}}));
  expect(response.status).toBe(201);
  const {id} = await response.json();
  for (let pass=0;pass<2;pass++) {
    if(pass) expect((await replaceArtifact(await observedRequest(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{markup:source.replace('Hello','Updated')}}),{params:Promise.resolve({id})})).status).toBe(200);
    const row = (await getArtifactById(id))!;
    expect(row.source).toMatch(/id="/);
    const stored=storedCompiledDataflow(row.meta,row.source!);
    expect(stored).toEqual(await compiledSource(row.source!));
    expect((row.meta.parsedArtifact as {sourceHash:string}).sourceHash).toBe(createHash('sha256').update(row.source!).digest('hex'));
    // Every span points at its declaration in the FINAL stamped source.
    for(const q of stored!.queries)expect(row.source!.slice(q.start,q.end)).toMatch(new RegExp(`^<Query name="${q.name}"`));
  }
});

it('malformed, missing and stale manifest data is reconstructed from canonical source', async () => {
  const expected=await compiledSource(source);
  const record={schemaVersion:2,compilerRevision:'sqlite-compiled-1',sourceHash:createHash('sha256').update(source).digest('hex'),compiled:expected};
  expect(storedCompiledDataflow({parsedArtifact:record},source)).toEqual(expected);
  for(const parsedArtifact of [null,{...record,schemaVersion:999},{...record,compiled:{values:'bad'}},{...record,sourceHash:'stale'},{...record,compilerRevision:'old'}]) {
    expect(storedCompiledDataflow({parsedArtifact},source)).toBeNull();
    expect(await readCompiledDataflow({parsedArtifact},source,async()=>null)).toEqual(expected);
  }
  expect(expected.queries.find((q)=>q.name==='b')!.reads.queries).toContain('a');
});

// The three dataset result-cache cases that sat here moved to shared-result-cache.test.ts,
// beside the rest of that cache's behaviour. What remains is the parsed-artifact manifest.
