import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page, startServer } from '../support/server.ts';
import type { PublishResponse } from '../../../src/server/af-api-contracts.ts';
test('trash disables hosted and source reads, retains history and restores the same ID', async () => {
 const server = await startServer();
 try {
  const token = await server.token();
  const published = await (await server.request('/api/publish', {token, body:{source:page('<h1>Retained</h1>'),requestId:'trash-history',visibility:'public'}})).json() as PublishResponse;
  assert.equal((await server.request(`/api/files/${published.id}`, {token,method:'DELETE'})).status,200);
  assert.equal((await server.request(`/af/v1/ids/${published.id}`)).status,404);
  assert.equal((await server.request(`/api/files/${published.id}/source`,{token})).status,404);
  assert.equal((await server.query('SELECT count(*)::int AS count FROM sources WHERE file_id=$1',[published.id])).rows[0]?.count,1);
  const entries = await (await server.request('/api/trash',{token})).json() as {entries:{id:string}[]};
  assert.equal(entries.entries[0]?.id,published.id);
  assert.equal((await server.request(`/api/trash/${published.id}/restore`,{token,body:{}})).status,200);
  assert.equal((await server.request(`/af/v1/ids/${published.id}`)).status,200);
 } finally {await server.close();}
});
