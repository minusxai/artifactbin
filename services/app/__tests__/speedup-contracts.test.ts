import {observedRequest} from '@/__tests__/conditional-request';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { useAppHarness, request } from './harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { PUT as replaceArtifact } from '@/app/api/artifacts/[id]/route';
import { getArtifactById } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { compileParsedArtifactMetadata, readParsedArtifactMetadata } from '@/lib/story/parsed-artifact-metadata';

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

// The three dataset result-cache cases that sat here moved to shared-result-cache.test.ts,
// beside the rest of that cache's behaviour. What remains is the parsed-artifact manifest.
