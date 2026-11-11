/** Create responses teach a page linking the dataset and reading it with sql; the ref field names what to link. */
import { describe, it, expect, beforeEach } from 'vitest';
import {POST as sqlDoor} from '@/app/api/artifacts/[id]/sql/route';
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
    expect(body.usage).not.toMatch(/\bgql\b|graphql/i);
    // The page's own statements, run through its SQL door as the page's reader runs them.
    const statements=[...body.usage.matchAll(/sql`([^`]+)`/g)].map(match=>match[1]);expect(statements).toHaveLength(2);
    const execute=async(sql:string)=>await(await sqlDoor(request(`/api/artifacts/${published.body.id}/sql`,{method:'POST',token,json:{sql,revision:'1'}}),{params:Promise.resolve({id:published.body.id})})).json();
    const [count,rows]=[await execute(statements[0]),await execute(statements[1])];
    expect(count.rows).toEqual([{n:2}]);
    expect(rows.rows.map(({month,revenue}:{month:string;revenue:number})=>[month,revenue])).toEqual([['2026-01',120],['2026-02',150]]);
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
