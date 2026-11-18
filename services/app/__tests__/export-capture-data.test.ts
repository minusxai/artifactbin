/**
 * THE EXPORT CAPTURE READS ITS DATA. The exporter photographs `raw?chrome=0&key=…`: a top-level page in the opaque
 * sandbox, with no app frame, so the frame relay never attaches. Without a transport of its own every `@afbin/apollo`
 * read answered "offline: nothing was sent": a deck that guards the read exported its slides with no numbers, and a
 * deck that throws drew no slide and the render failed at the deadline. The capture reads the page GraphQL endpoint
 * directly (html-runtime/domain-reads): an opaque origin's request is answered with the anonymous read ACL whatever
 * credential it carries, query-only, and readable cross-origin — unless it carries an export key minted for a
 * requester, read as that requester (export-access.test.ts). Its `sql` reads the page SQL door the same way, but only
 * with a key: as the key's requester, read-only (lib/page-doors `opaqueSqlRead`).
 */
import { beforeEach, expect, it } from 'vitest';
import { mintAccountToken, request, setSession, useAppHarness, params } from './harness';
import { STAFF, staffDeck, runtime } from './export-helpers';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { mintExportKey } from '@/lib/export';
import { GET as serveRaw } from '@/app/a/[id]/raw/route';
import { POST as sqlDoor } from '@/app/api/artifacts/[id]/sql/route';

useAppHarness();
beforeEach(() => setSession(null));

async function deck() {
  const minted = await mintAccountToken('ecd_owner');
  const actor = identityForUser(minted.userId, minted.id, minted.email) as AccessActor & { tokenId: string };
  return { token: minted.token, actor, page: (await staffDeck(actor, 'unlisted')).page };
}
const connectSrc = (policy: string | null) => /connect-src ([^;]+)/.exec(policy ?? '')?.[1] ?? '';

it('serves the export capture with direct data reads, and an ordinary raw page without them', async () => {
  const { page } = await deck();
  const sqlReads = `http://localhost:3000/api/artifacts/${page}/sql`;
  const capture = await serveRaw(request(`/a/${page}/raw?chrome=0&key=${encodeURIComponent(mintExportKey(page))}`), params(page));
  expect(capture.status).toBe(200);
  expect(runtime(await capture.text()).domainReads).toBe(true);
  expect(connectSrc(capture.headers.get('content-security-policy'))).toContain(sqlReads);
  const plain = await serveRaw(request(`/a/${page}/raw?chrome=0`), params(page));
  expect(plain.status).toBe(200);
  expect(runtime(await plain.text()).domainReads).toBeUndefined();
  expect(connectSrc(plain.headers.get('content-security-policy'))).not.toContain(sqlReads);
});

type SqlReply = { rows?: Array<Record<string, unknown>>; error?: string };
it('answers an export capture\'s sql as the key\'s requester, read-only and readable cross-origin, and no other opaque sql at all', async () => {
  const { token, actor, page } = await deck();
  const other = (await deck()).page;
  const ask = async (sql: string, extra: Record<string, unknown> = {}, opts: { token?: string; origin?: string; id?: string } = {}) => {
    const response = await sqlDoor(request(`/api/artifacts/${opts.id ?? page}/sql`, { method: 'POST', ...(opts.token ? { token: opts.token } : {}), headers: { 'content-type': 'text/plain;charset=UTF-8', origin: opts.origin ?? 'null' }, body: JSON.stringify({ sql, params: {}, revision: '1', readOnly: true, ...extra }) }), params(opts.id ?? page));
    return { status: response.status, cors: response.headers.get('access-control-allow-origin'), body: await response.json() as SqlReply };
  };
  const owner = mintExportKey(page, undefined, undefined, actor), anonymous = mintExportKey(page);
  // The owner's capture reads what the owner reads: every column.
  const mine = await ask('select name, team from staff order by name', { key: owner });
  expect(mine).toMatchObject({ status: 200, cors: '*' });
  expect(mine.body.rows).toEqual(STAFF);
  // A signed-out capture reads what a signed-out reader does: names, never the team column.
  expect((await ask('select name from staff order by name', { key: anonymous })).body.rows).toEqual([{ name: 'ada' }, { name: 'bo' }]);
  expect((await ask('select team from staff', { key: anonymous })).body.error).toBe('validation_failed');
  // A credential the browser attaches never widens an anonymous capture.
  expect((await ask('select team from staff', { key: anonymous }, { token })).body.error).toBe('validation_failed');
  // It reads, never writes, even as the owner and even when the body says it may.
  const write = await ask("insert into staff (name, team) values ('cy', 'red')", { key: owner, readOnly: false });
  expect(write.body.error).toBe('permission_denied');
  expect((await ask('select count(*) as n from staff', { key: owner })).body.rows).toEqual([{ n: 2 }]);
  // No key, a credential instead of a key, a key for another page, a forged key: no SQL door for an opaque origin.
  for (const refused of [await ask('select name from staff'), await ask('select name from staff', {}, { token }), await ask('select name from staff', { key: mintExportKey(other, undefined, undefined, actor) }), await ask('select name from staff', { key: `${owner}0` })])
    expect([refused.status, refused.body.error]).toEqual([403, 'permission_denied']);
  // The key opens only an opaque origin's read: the page's own reader path is unchanged and never readable cross-origin.
  const same = await ask('select name, team from staff order by name', { key: anonymous }, { token, origin: 'http://localhost:3000' });
  expect([same.status, same.cors, same.body.rows]).toEqual([200, null, STAFF]);
});
