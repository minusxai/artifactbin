/** Create responses teach the Import of the dataset and a query over it, with real columns; the ref field names what to import. */
import { describe, it, expect, beforeEach } from 'vitest';
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import {request} from './harness';
import { POST as createArtifact } from '@/app/api/artifacts/route';

import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();


let token: string;

beforeEach(async () => {
  token = (await mintToken('hint-test')).token;
});

const create = async (body: Record<string, unknown>) => {
  const res = await createArtifact(new Request('http://localhost:3000/api/artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

describe('creating a dataset returns how to USE it', () => {
  it('hands back the ref form, not just a bare id', async () => {
    const { body } = await create({ title: 'sales', dataset: 'month,revenue\n2026-01,120' });
    expect(body.ref).toBe(`ref:${body.id}`);
  });

  it('returns a native HTML usage page that publishes with its dataset binding',async()=>{
    const {body}=await create({title:'sales',dataset:'month,revenue\n2026-01,120\n2026-02,150'});
    expect(body.usage).toContain('<!doctype html>');expect(body.usage).toContain(`href="ref:${body.id}"`);
    const published=await create({html:body.usage});expect(published.status,JSON.stringify(published.body)).toBe(201);
    const queries=[...body.usage.matchAll(/gql`([^`]+)`/g)].map(match=>match[1]);expect(queries).toHaveLength(2);
    const execute=async(query:string,variables={})=>await(await graphql(request(`/api/artifacts/${published.body.id}/graphql`,{method:'POST',token,json:{revision:'1',query,variables}}),{params:Promise.resolve({id:published.body.id})})).json();
    const schema=await execute(queries[0]);expect(schema.errors).toBeUndefined();
    const rows=await execute(queries[1],{table:schema.data.data.schema.tables[0].id});expect(rows.errors).toBeUndefined();expect(rows.data.data.rows.rows).toHaveLength(2);
  });

  it('still returns something useful when there is no numeric column', async () => {
    const { body } = await create({ title: 'names', dataset: 'a,b\nx,y' });
    expect(body.ref).toBe(`ref:${body.id}`);
    expect(typeof body.usage).toBe('string');
    expect(body.usage.length).toBeGreaterThan(0);
  });

  it('does not attach dataset usage to other tiers', async () => {
    const { body } = await create({ title: 'doc', html: '<html><body><h1>Hi</h1></body></html>' });
    expect(body.ref).toBeUndefined();
    expect(body.usage).toBeUndefined();
  });
});
