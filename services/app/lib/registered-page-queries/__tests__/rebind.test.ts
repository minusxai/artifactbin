import { describe, expect, it } from 'vitest';
import type { HtmlBackendLink } from '@artifactbin/contracts';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { getDb, type Queryable } from '@/lib/platform';
import { POST as create } from '@/app/api/artifacts/route';
import {
  RegisteredQueryRebindError, commitRegisteredQueryRebinds, pageSourceDigest, planRegisteredQueryRebinds, planRegisteredQueryRepair, prepareRegisteredQueryBackend,
} from '..';

useAppHarness();
const provenance = { compilerSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64), sqlEngineSha256: 'c'.repeat(64) };
const program = {
  scalars: { amount: { type: 'number' as const, default: null } },
  queries: [{ name: 'sum', sql: 'select sum(amount) as amount from items.rows where $amount is null or amount >= $amount', dependencies: [] }],
  imports: [{ alias: 'items', binding: 'private-source', table: 'rows' }],
};
const plain: HtmlBackendLink = { kind: 'backend', name: 'plain', backendId: 'be_plain', version: 'v1' };
type Prepared = ReturnType<typeof prepareRegisteredQueryBackend>;
async function insertBackend(tx: Queryable, pageId: string, ownerId: string, prepared: Prepared) {
  await tx.query('INSERT INTO html_backend_versions (backend_id, version, page_id, name, source, type_defs, compiled, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [prepared.link.backendId, prepared.link.version, pageId, prepared.link.name, prepared.backend.source, prepared.backend.typeDefs, prepared.backend.compiled, ownerId]);
}
/** A page saved at version 1 whose `queries` program is registered to it; `next` is the version a save is writing. */
async function fixture() {
  const owner = await mintAccountToken('rebind-queries');
  const made = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: { html: '<!doctype html><html><head></head><body><p>v1</p></body></html>' } }));
  const pageId = (await made.json() as { id: string }).id;
  const db = await getDb();
  const source = (await db.query<{ source: string }>('SELECT source FROM artifacts WHERE id = $1', [pageId])).rows[0]!.source;
  const prepared = prepareRegisteredQueryBackend('queries', 'be_queries', { pageId, version: 1, html: source }, program, provenance);
  await insertBackend(db, pageId, owner.userId!, prepared);
  const next = { pageId, version: 2, html: source.replace('v1', 'v2 ü') };
  /** Writes `next` as the head with these links, as the save that planned them would. */
  const save = (links: unknown[]) => db.query("UPDATE artifacts SET version = 2, source = $2, meta = jsonb_set(meta, '{htmlLinks}', $3::jsonb) WHERE id = $1", [pageId, next.html, JSON.stringify(links)]);
  return { db, owner, pageId, prepared, next, save };
}
const backendVersions = async (db: Queryable) => (await db.query<{ version: string }>("SELECT version FROM html_backend_versions WHERE backend_id = 'be_queries' ORDER BY version")).rows.map(row => row.version);

describe('pageSourceDigest', () => {
  it('is the sha256 hex of the exact page bytes', () => {
    expect(pageSourceDigest('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(pageSourceDigest('<p>ü</p>')).not.toBe(pageSourceDigest('<p>u</p>'));
  });
});

describe('planRegisteredQueryRebinds and commitRegisteredQueryRebinds', () => {
  it('re-binds a carried program to the new version, passes other links through, and commits it beside the old one', async () => {
    const f = await fixture();
    const planned = await planRegisteredQueryRebinds(f.db, f.next, [f.prepared.link, plain], f.owner.userId);
    expect(planned.links[1]).toEqual(plain);
    expect(planned.links[0]).toMatchObject({ kind: 'backend', name: 'queries', backendId: 'be_queries' });
    expect(planned.links[0]!.version).not.toBe(f.prepared.link.version);
    expect(planned.rebinds).toHaveLength(1);
    expect(planned.rebinds[0]!.prepared.envelope).toMatchObject({ pageVersion: 2, sourceSha256: pageSourceDigest(f.next.html), program });
    await f.save(planned.links);
    await commitRegisteredQueryRebinds(f.db, f.next, planned.rebinds);
    expect((await backendVersions(f.db)).sort()).toEqual([f.prepared.link.version, planned.links[0]!.version].sort());
  });

  it('answers no work for no carried links, and commits nothing for no rebinds', async () => {
    const f = await fixture();
    expect(await planRegisteredQueryRebinds(f.db, f.next, [], f.owner.userId)).toEqual({ links: [], rebinds: [] });
    await commitRegisteredQueryRebinds(f.db, f.next, []);
    expect(await backendVersions(f.db)).toEqual([f.prepared.link.version]);
  });

  it('refuses before writing when the owner changed, the version did not advance, or the stored bytes were altered', async () => {
    const f = await fixture();
    const refusal = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as RegisteredQueryRebindError);
    const stranger = await refusal(planRegisteredQueryRebinds(f.db, f.next, [f.prepared.link], 'usr_other'));
    expect(stranger).toBeInstanceOf(RegisteredQueryRebindError);
    expect(stranger).toMatchObject({ namespace: 'queries', reason: 'query_registration_owner_changed' });
    expect(stranger!.message).toBe("registered queries 'queries' cannot be re-bound: query_registration_owner_changed");
    expect(await refusal(planRegisteredQueryRebinds(f.db, { ...f.next, version: 1 }, [f.prepared.link], f.owner.userId))).toMatchObject({ reason: 'query_registration_changed' });
    expect(await refusal(planRegisteredQueryRebinds(f.db, { ...f.next, pageId: 'other_page' }, [f.prepared.link], f.owner.userId))).toMatchObject({ reason: 'query_registration_changed' });
    await f.db.query("UPDATE html_backend_versions SET source = source || ' ' WHERE backend_id = 'be_queries'");
    expect(await refusal(planRegisteredQueryRebinds(f.db, f.next, [f.prepared.link], f.owner.userId))).toMatchObject({ reason: 'query_registration_changed' });
    expect(await backendVersions(f.db)).toEqual([f.prepared.link.version]);
  });

  it('refuses to commit a rebind the saved head does not link', async () => {
    const f = await fixture();
    const planned = await planRegisteredQueryRebinds(f.db, f.next, [f.prepared.link], f.owner.userId);
    await f.save([f.prepared.link]);
    await expect(commitRegisteredQueryRebinds(f.db, f.next, planned.rebinds)).rejects.toThrow('query_registration_changed');
  });
});

describe('planRegisteredQueryRepair', () => {
  it('re-binds a head whose registered link is bound to an earlier version, keeping dataset links in place', async () => {
    const f = await fixture();
    const head = { id: f.pageId, user_id: f.owner.userId, version: 2, source: f.next.html, meta: { htmlLinks: [{ kind: 'dataset' as const }, f.prepared.link] } };
    const repair = await planRegisteredQueryRepair(f.db, head);
    expect(repair).not.toBeNull();
    expect(repair!.links[0]).toEqual({ kind: 'dataset' });
    const rebound = repair!.links[1] as HtmlBackendLink;
    expect(rebound.version).not.toBe(f.prepared.link.version);
    await f.save(repair!.links);
    expect(await repair!.commit()).toEqual(['queries']);
    expect(await backendVersions(f.db)).toContain(rebound.version);
    expect(await planRegisteredQueryRepair(f.db, { ...head, meta: { htmlLinks: repair!.links } })).toBeNull();
  });

  it('is null for a page without registered links, or whose backend rows are missing', async () => {
    const f = await fixture();
    const head = { id: f.pageId, user_id: f.owner.userId, version: 2, source: f.next.html, meta: {} };
    expect(await planRegisteredQueryRepair(f.db, head)).toBeNull();
    expect(await planRegisteredQueryRepair(f.db, { ...head, meta: { htmlLinks: [plain, { kind: 'dataset' as const }] } })).toBeNull();
  });
});
