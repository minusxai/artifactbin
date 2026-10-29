import { describe, expect, it } from 'vitest';
import type { HtmlBackendLink } from '@artifactbin/contracts';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { getDb, type Queryable } from '@/lib/platform';
import { POST as create } from '@/app/api/artifacts/route';
import { pageSourceDigest } from '@/lib/registered-page-queries';
import type { MutationProgram } from '..';
import {
  RegisteredMutationRebindError, commitRegisteredMutationRebinds, planRegisteredMutationRebinds, planRegisteredMutationRepair, prepareRegisteredMutationBackend,
} from '..';

useAppHarness();
const provenance = { compilerSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64) };
const program: MutationProgram = { name: 'save', kind: 'insert', sql: 'INSERT INTO form.rows(body) VALUES ($body)', target: { datasetId: 'private-dataset', schema: 'form', table: 'rows' }, values: { body: { type: 'string', nullable: false, parameter: 'body' } }, builtins: [], expectedAffected: 1, reset: ['body'] };
const plain: HtmlBackendLink = { kind: 'backend', name: 'plain', backendId: 'be_plain', version: 'v1' };
type Prepared = ReturnType<typeof prepareRegisteredMutationBackend>;
async function insertBackend(tx: Queryable, pageId: string, ownerId: string, prepared: Prepared) {
  await tx.query('INSERT INTO html_backend_versions (backend_id, version, page_id, name, source, type_defs, compiled, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [prepared.link.backendId, prepared.link.version, pageId, prepared.link.name, prepared.backend.source, prepared.backend.typeDefs, prepared.backend.compiled, ownerId]);
}
/** A page saved at version 1 whose `actions` mutation program is registered to it; `next` is the version a save is writing. */
async function fixture() {
  const owner = await mintAccountToken('rebind-mutations');
  const made = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: { html: '<!doctype html><html><head></head><body><p>v1</p></body></html>' } }));
  const pageId = (await made.json() as { id: string }).id;
  const db = await getDb();
  const source = (await db.query<{ source: string }>('SELECT source FROM artifacts WHERE id = $1', [pageId])).rows[0]!.source;
  const prepared = prepareRegisteredMutationBackend('actions', 'be_mutations', { pageId, version: 1, html: source }, program, provenance);
  await insertBackend(db, pageId, owner.userId!, prepared);
  const next = { pageId, version: 2, html: source.replace('v1', 'v2 ü') };
  /** Writes `next` as the head with these links, as the save that planned them would. */
  const save = (links: unknown[]) => db.query("UPDATE artifacts SET version = 2, source = $2, meta = jsonb_set(meta, '{htmlLinks}', $3::jsonb) WHERE id = $1", [pageId, next.html, JSON.stringify(links)]);
  return { db, owner, pageId, prepared, next, save };
}
const backendVersions = async (db: Queryable) => (await db.query<{ version: string }>("SELECT version FROM html_backend_versions WHERE backend_id = 'be_mutations' ORDER BY version")).rows.map(row => row.version);

describe('planRegisteredMutationRebinds and commitRegisteredMutationRebinds', () => {
  it('re-binds a carried program to the new version, passes other links through, and commits it beside the old one', async () => {
    const f = await fixture();
    const planned = await planRegisteredMutationRebinds(f.db, f.next, [f.prepared.link, plain], f.owner.userId);
    expect(planned.links[1]).toEqual(plain);
    expect(planned.links[0]).toMatchObject({ kind: 'backend', name: 'actions', backendId: 'be_mutations' });
    expect(planned.links[0]!.version).not.toBe(f.prepared.link.version);
    expect(planned.rebinds).toHaveLength(1);
    expect(planned.rebinds[0]!.prepared.envelope).toMatchObject({ pageVersion: 2, sourceSha256: pageSourceDigest(f.next.html), program });
    await f.save(planned.links);
    await commitRegisteredMutationRebinds(f.db, f.next, planned.rebinds);
    expect((await backendVersions(f.db)).sort()).toEqual([f.prepared.link.version, planned.links[0]!.version].sort());
  });

  it('answers no work for no carried links, and commits nothing for no rebinds', async () => {
    const f = await fixture();
    expect(await planRegisteredMutationRebinds(f.db, f.next, [], f.owner.userId)).toEqual({ links: [], rebinds: [] });
    await commitRegisteredMutationRebinds(f.db, f.next, []);
    expect(await backendVersions(f.db)).toEqual([f.prepared.link.version]);
  });

  it('refuses before writing when the owner changed, the version did not advance, or the stored bytes were altered', async () => {
    const f = await fixture();
    const refusal = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as RegisteredMutationRebindError);
    const stranger = await refusal(planRegisteredMutationRebinds(f.db, f.next, [f.prepared.link], 'usr_other'));
    expect(stranger).toBeInstanceOf(RegisteredMutationRebindError);
    expect(stranger).toMatchObject({ namespace: 'actions', reason: 'mutation_registration_owner_changed' });
    expect(stranger!.message).toBe("registered mutations 'actions' cannot be re-bound: mutation_registration_owner_changed");
    expect(await refusal(planRegisteredMutationRebinds(f.db, { ...f.next, version: 1 }, [f.prepared.link], f.owner.userId))).toMatchObject({ reason: 'mutation_registration_changed' });
    expect(await refusal(planRegisteredMutationRebinds(f.db, { ...f.next, pageId: 'other_page' }, [f.prepared.link], f.owner.userId))).toMatchObject({ reason: 'mutation_registration_changed' });
    await f.db.query("UPDATE html_backend_versions SET source = source || ' ' WHERE backend_id = 'be_mutations'");
    expect(await refusal(planRegisteredMutationRebinds(f.db, f.next, [f.prepared.link], f.owner.userId))).toMatchObject({ reason: 'mutation_registration_changed' });
    expect(await backendVersions(f.db)).toEqual([f.prepared.link.version]);
  });

  it('refuses to commit a rebind the saved head does not link', async () => {
    const f = await fixture();
    const planned = await planRegisteredMutationRebinds(f.db, f.next, [f.prepared.link], f.owner.userId);
    await f.save([f.prepared.link]);
    await expect(commitRegisteredMutationRebinds(f.db, f.next, planned.rebinds)).rejects.toThrow('mutation_registration_changed');
  });
});

describe('planRegisteredMutationRepair', () => {
  it('re-binds a head whose registered link is bound to an earlier version, keeping dataset links in place', async () => {
    const f = await fixture();
    const head = { id: f.pageId, user_id: f.owner.userId, version: 2, source: f.next.html, meta: { htmlLinks: [{ kind: 'dataset' as const }, f.prepared.link] } };
    const repair = await planRegisteredMutationRepair(f.db, head);
    expect(repair).not.toBeNull();
    expect(repair!.links[0]).toEqual({ kind: 'dataset' });
    const rebound = repair!.links[1] as HtmlBackendLink;
    expect(rebound.version).not.toBe(f.prepared.link.version);
    await f.save(repair!.links);
    expect(await repair!.commit()).toEqual(['actions']);
    expect(await backendVersions(f.db)).toContain(rebound.version);
    expect(await planRegisteredMutationRepair(f.db, { ...head, meta: { htmlLinks: repair!.links } })).toBeNull();
  });

  it('is null for a page without registered links, or whose backend rows are missing', async () => {
    const f = await fixture();
    const head = { id: f.pageId, user_id: f.owner.userId, version: 2, source: f.next.html, meta: {} };
    expect(await planRegisteredMutationRepair(f.db, head)).toBeNull();
    expect(await planRegisteredMutationRepair(f.db, { ...head, meta: { htmlLinks: [plain, { kind: 'dataset' as const }] } })).toBeNull();
  });
});
