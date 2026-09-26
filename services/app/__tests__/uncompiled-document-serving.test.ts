/**
 * A DOCUMENT WHOSE DATA HALF DOES NOT COMPILE still renders, and every one of
 * its queries says why — by declaration name, as publish would have refused
 * it — at every door that reads it: the page, the query transport, the live
 * frame and the command-line query. A write it declares is refused with the
 * same errors. Nothing answers with silence (no rows and no error).
 *
 * Such a document exists because its imports can change shape after publish,
 * and because a document the previous engine stored is served converted
 * (lib/migrate/sqlite/stored) before the migration has compiled it.
 */
import { artifactQuery } from '@/lib/artifact-document';
import { describe, expect, it } from 'vitest';
import { request, useAppHarness } from './harness';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { POST as mutateRoute } from '@/app/a/[id]/mutate/route';
import { POST as queryRoute } from '@/app/a/[id]/query/route';
import { getArtifactById } from '@/lib/artifacts';
import { liveFrameFor } from '@/lib/story/frame';
import { queryResourceForRequest } from '@/lib/resource-query';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

const harness = useAppHarness();
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function owner() {
  const token = await mintToken('mxmx_test_uncompiled');
  const user = await createUser({ email: 'uncompiled-owner@example.com' });
  await claimToken(user.id, token.token);
  return { token: token.token, tokenId: token.id, userId: user.id, email: user.email, actor: { tokenId: token.id, userId: user.id } };
}
type Owner = Awaited<ReturnType<typeof owner>>;

async function store(who: Owner, id: string, source: string, meta: Record<string, unknown>) {
  await artifactQuery(await harness.db(), `INSERT INTO artifacts (id,token_id,user_id,source,format,version,visibility,meta) VALUES ($1,$2,$3,$4,'markup',1,'unlisted',$5::jsonb)`, [id, who.tokenId, who.userId, source, JSON.stringify(meta)]);
}

const query = async (doc: string, who: Owner) => {
  const res = await queryRoute(request(`/a/${doc}/query`, { method: 'POST', json: { tz: 'UTC' }, actor: { credential: 'session', userId: who.userId, email: who.email } }), ctx(doc));
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as { tables: Record<string, unknown>; errors: Record<string, string> };
};

const BROKEN = '<Query name="broken"> no such function: no_such_function';
/** One query that cannot compile, one that could on its own, a Value, and a write. */
const SOURCE = [
  '<Helmet>',
  '<Value name="pick" type="number" default={3} />',
  '<Value name="notes" type="table" value={[{"n": 1}]} />',
  '<Query name="broken">{`select no_such_function(n) as x from notes`}</Query>',
  '<Query name="fine">{`select n + $pick as y from notes`}</Query>',
  '<Mutation name="add">{`insert into notes (n) values ($pick)`}</Mutation>',
  '</Helmet>',
  '<main><p>Still here</p><DataTable data="$fine" /><Button run="$add">Add</Button></main>',
].join('');

describe('a document whose data does not compile', () => {
  for (const [kind, meta] of [['in the current syntax', { dataSyntax: 2 }], ['stored by the previous engine', {}]] as const) {
    it(`${kind}: renders, and every query answers with the compile error by declaration name`, async () => {
      const who = await owner();
      const id = kind === 'stored by the previous engine' ? 'oldbrk' : 'curbrk';
      await store(who, id, SOURCE, meta);

      const page = await serveArtifact(request(`/a/${id}/raw`, { token: who.token }), ctx(id));
      expect(page.status).toBe(200);
      const html = await page.text();
      // Asserted as booleans: a failure would otherwise print the whole page.
      expect(html.includes('Still here')).toBe(true);
      expect(html.includes('no such function: no_such_function')).toBe(true);

      const answered = await query(id, who);
      expect(Object.keys(answered.tables)).toEqual(['notes']); // the table Value, and no query's rows
      expect(answered.errors).toEqual({ broken: BROKEN, fine: BROKEN });

      const frame = await liveFrameFor((await getArtifactById(id))!);
      expect(frame.dataflow?.state).toMatchObject({ values: { pick: 3 }, errors: { broken: BROKEN, fine: BROKEN } });

      const cli = await queryResourceForRequest(who.actor, id, {}, request(`/api/query`, { method: 'POST', token: who.token }));
      expect(cli.status).toBe(400);
      expect(await cli.json()).toMatchObject({ error: 'query_failed', name: 'broken', detail: BROKEN });

      const add = await mutateRoute(request(`/a/${id}/mutate`, { method: 'POST', json: { mutation: 'add' }, token: who.token }), ctx(id));
      expect(add.status).toBe(400);
      expect(await add.json()).toEqual({ error: 'mutation_failed', detail: BROKEN });

      // Nothing about a failed compile is remembered as the document's compiled record.
      expect((await getArtifactById(id))!.meta).not.toHaveProperty('parsedArtifact');
    });
  }
});
