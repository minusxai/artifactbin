/** Dataset query inputs, pagination and access survive removal of the story compatibility door. */
import {describe, expect, it} from 'vitest';
import {request, useAppHarness} from '@/__tests__/harness';
import {createArtifactFromBody} from '@/lib/publish';
import {mintAccountToken} from '@/__tests__/harness';
import {identityForUser} from '@/lib/accounts';
import {queryResourceForRequest} from '../resource-query';

useAppHarness();
async function account(name: string) {
  const token = await mintAccountToken(name);
  return {tokenId: token.id, actor: identityForUser(token.userId, token.id, token.email)};
}
async function datasetFixture(body: Record<string, unknown>) {
  const owner = await account('owner');
  const created = await createArtifactFromBody({dataset: [{n: 1}], visibility: 'public', ...body}, {...owner.actor, tokenId: owner.tokenId}, 'http://localhost:3000');
  expect(created.status).toBe(201);
  return {owner, id: (await created.json()).id as string};
}

const query = (actor: Parameters<typeof queryResourceForRequest>[0], id: string, body: Record<string, unknown>) =>
  queryResourceForRequest(actor, id, body, request(`/api/artifacts/${id}/query`, {method: 'POST'}));

describe('dataset query contract', () => {
  it('pages a named table, binds scalar SQL values, and refuses a cursor for changed inputs', async () => {
    const f = await datasetFixture({dataset: [{n: 1}, {n: 2}, {n: 3}]});
    const body = {name: 'public.rows', limit: 2};
    const first = await query(f.owner.actor, f.id, body);
    expect(first.status).toBe(200);
    const result = (await first.json()).results[0];
    expect(result.rows).toHaveLength(2);
    expect(result.next_cursor).toEqual(expect.any(String));
    const next = await query(f.owner.actor, f.id, {...body, cursor: result.next_cursor});
    expect((await next.json()).results[0]).toMatchObject({rows: [{n: 3}], next_cursor: null});
    expect((await query(f.owner.actor, f.id, {...body, limit: 1, cursor: result.next_cursor})).status).toBe(400);
    const bound = await query(f.owner.actor, f.id, {sql: 'select n from public.rows where n = $n', values: {n: 2}});
    expect((await bound.json()).results[0].rows).toEqual([{n: 2}]);
    for (const values of [[], {n: {}}, {n: Infinity}, {n: NaN}]) {
      expect(await (await query(f.owner.actor, f.id, {values})).json()).toMatchObject({error: 'invalid_values'});
    }
  });

  it('keeps private datasets hidden from strangers while admitting the owner', async () => {
    const f = await datasetFixture({visibility: 'private'}), stranger = await account('stranger');
    expect((await query(f.owner.actor, f.id, {name: 'public.rows'})).status).toBe(200);
    expect((await query(stranger.actor, f.id, {name: 'public.rows'})).status).toBe(404);
  });

  it('refuses readable documents and folders rather than answering empty declared queries', async () => {
    const owner = await account('owner');
    for (const content of [{html: '<html><body>Page</body></html>'}, {format: 'folder'}]) {
      const created = await createArtifactFromBody({...content, visibility: 'public'}, {...owner.actor, tokenId: owner.tokenId}, 'http://localhost:3000');
      expect(created.status).toBe(201);
      const {id} = await created.json();
      for (const body of [{}, {name: 'old_query'}, {sql: 'select 1'}]) {
        expect(await (await query(owner.actor, id, body)).json()).toEqual({error: 'not_queryable'});
      }
    }
  });
});
