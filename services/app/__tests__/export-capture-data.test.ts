/**
 * THE EXPORT CAPTURE READS ITS DATA. The exporter photographs `raw?chrome=0&key=…`: a top-level page in the opaque
 * sandbox, with no app frame, so the frame relay never attaches. Without a transport of its own every `@afbin/apollo`
 * read answered "offline: nothing was sent": a deck that guards the read exported its slides with no numbers, and a
 * deck that throws drew no slide and the render failed at the deadline. The capture reads the page GraphQL endpoint
 * directly (html-runtime/domain-reads): an opaque origin's request is answered with the anonymous read ACL whatever
 * credential it carries, query-only, and readable cross-origin — unless it carries an export key minted for a
 * requester, read as that requester (export-access.test.ts).
 */
import { beforeEach, expect, it } from 'vitest';
import { mintAccountToken, request, setSession, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { mintExportKey } from '@/lib/export';
import { GET as serveRaw } from '@/app/a/[id]/raw/route';
import { POST as graphql } from '@/app/api/artifacts/[id]/graphql/route';

useAppHarness();
beforeEach(() => setSession(null));

const params = (id: string) => ({ params: Promise.resolve({ id }) });
type Reply = { data?: Record<string, any> | null; errors?: Array<{ message: string }> };
const STAFF = [{ name: 'ada', team: 'red' }, { name: 'bo', team: 'blue' }];
const ROWS = { schema: 'public', name: 'rows' };
/** Signed-in readers see every column; anonymous readers see names only. */
const POLICY = { version: 3, tables: [{
  table: ROWS,
  select_permissions: [
    { role: 'signed_in', permission: { columns: '*', filter: {}, allow_aggregations: true } },
    { role: 'anonymous', permission: { columns: ['name'], filter: {} } },
  ],
  insert_permissions: [{ role: 'signed_in', permission: { columns: ['name', 'team'], check: {} } }],
}] };

async function deck() {
  const minted = await mintAccountToken('ecd_owner');
  const actor = identityForUser(minted.userId, minted.id, minted.email) as AccessActor & { tokenId: string };
  const dataset = await createArtifactFromBody({ dataset: STAFF, title: 'Staff', access: 'readwrite', visibility: 'unlisted' }, actor, 'http://localhost:3000');
  expect(dataset.status).toBe(201);
  const staff = (await dataset.json() as { id: string }).id;
  await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [staff, JSON.stringify(POLICY)]);
  const html = `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${staff}"></head><body><main id="deck"></main></body></html>`;
  const page = await createArtifactFromBody({ html, visibility: 'unlisted' }, actor, 'http://localhost:3000');
  expect(page.status).toBe(201);
  return { token: minted.token, page: (await page.json() as { id: string }).id };
}
const runtime = (html: string) => JSON.parse(/<script type="application\/json" data-af="runtime">([^<]*)<\/script>/.exec(html)![1]!) as { domainReads?: true };
const connectSrc = (policy: string | null) => /connect-src ([^;]+)/.exec(policy ?? '')?.[1] ?? '';

it('serves the export capture with direct data reads, and an ordinary raw page without them', async () => {
  const { page } = await deck();
  const reads = `http://localhost:3000/api/artifacts/${page}/graphql`;
  const capture = await serveRaw(request(`/a/${page}/raw?chrome=0&key=${encodeURIComponent(mintExportKey(page))}`), params(page));
  expect(capture.status).toBe(200);
  expect(runtime(await capture.text()).domainReads).toBe(true);
  expect(connectSrc(capture.headers.get('content-security-policy'))).toContain(reads);
  const plain = await serveRaw(request(`/a/${page}/raw?chrome=0`), params(page));
  expect(plain.status).toBe(200);
  expect(runtime(await plain.text()).domainReads).toBeUndefined();
  expect(connectSrc(plain.headers.get('content-security-policy'))).not.toContain(reads);
});

it('answers an opaque-origin read as a guest, readable cross-origin, and refuses its writes', async () => {
  const { token, page } = await deck();
  const ask = (query: string, headers: Record<string, string> = {}) => graphql(request(`/api/artifacts/${page}/graphql`, { method: 'POST', token, headers: { 'content-type': 'text/plain;charset=UTF-8', ...headers }, body: JSON.stringify({ query, revision: '1', operation: /^\s*mutation\b/.test(query) ? 'mutation' : 'query' }) }), params(page));
  // The owner's own request reads every column, and is not readable cross-origin.
  const owner = await ask('{staff(order_by:{name:asc}){name team}}');
  expect(owner.status).toBe(200);
  expect((await owner.json() as Reply).data?.staff).toEqual(STAFF);
  expect(owner.headers.get('access-control-allow-origin')).toBeNull();
  // The same credential from an opaque origin reads as nobody: names only, and the response is readable there.
  const guest = await ask('{staff(order_by:{name:asc}){name}}', { origin: 'null' });
  expect(guest.status).toBe(200);
  expect(guest.headers.get('access-control-allow-origin')).toBe('*');
  expect((await guest.json() as Reply).data?.staff).toEqual([{ name: 'ada' }, { name: 'bo' }]);
  const column = await ask('{staff{team}}', { origin: 'null' });
  expect((await column.json() as Reply).errors?.length).toBeGreaterThan(0);
  const write = await ask('mutation{insert_staff_one(object:{name:"cy",team:"red"}){name}}', { origin: 'null' });
  expect(write.status).toBe(403);
  expect(write.headers.get('access-control-allow-origin')).toBe('*');
  const after = await ask('{staff(order_by:{name:asc}){name}}');
  expect((await after.json() as Reply).data?.staff).toEqual([{ name: 'ada' }, { name: 'bo' }]);
});
