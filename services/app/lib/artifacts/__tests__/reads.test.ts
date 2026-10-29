/**
 * READING A ROW through the interface: the unscoped and scoped lookups, the header and identity reads, the link-
 * readable cut, reader admission and the reader's snapshot, and what the current code still serves (retired
 * shapes, archived versions at an address, image references and view admission).
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { identityForUser, mintToken } from '@/lib/accounts';
import { flushViews } from '@/lib/analytics';
import {
  VERSION_PARAM, UnservableDocument, accessMoved, archivedVersionFor, archivedVersionForActor, createArtifact, getArtifact, getArtifactAccessById,
  getArtifactById, getArtifactFor, getArtifactHeaderById, getArtifactsFor, getEditableArtifactFor, getLinkReadableArtifact, getLinkReadableArtifacts,
  getOwnedArtifactFor, hasInvitedUsersFor, readableArtifact, readableArtifactHeader, readableArtifactIdentity, recordArtifactView, refusingUnservable,
  replaceArtifactFor, resolveImageReference, servableDocument, servedRow, snapshotForReader, snapshotHeadFor, unservable, updateSharingFor, type ArtifactRow,
} from '@/lib/artifacts';
import { account, dataset, head, mine, page, sql } from './fixtures';

useAppHarness();

describe('row lookups', () => {
  it('the header, access and identity reads carry no content, and every read honours the trash gate', async () => {
    const owner = await account('owner@example.test');
    const row = await mine(owner);
    const header = (await getArtifactHeaderById(row.id))!;
    expect(header).not.toHaveProperty('source');
    expect(header).not.toHaveProperty('document');
    expect(header).toMatchObject({ id: row.id, edit_id: row.edit_id });
    expect(Object.keys((await getArtifactAccessById(row.id))!).sort()).toEqual(['format', 'group_id', 'id', 'link_role', 'token_id', 'user_id', 'version', 'visibility']);
    const identity = (await readableArtifactIdentity(owner, row.id))!;
    expect(identity.role).toBe('owner');
    expect(identity.row).not.toHaveProperty('meta');
    expect(identity.row.meta_digest).toMatch(/^[a-f0-9]{32}$/);
    expect((await getArtifactById(row.id))!.source).toBe(row.source);
    await sql('UPDATE artifacts SET deleted_at=now() WHERE id=$1', [row.id]);
    expect([await getArtifactById(row.id), await getArtifactHeaderById(row.id), await getArtifactAccessById(row.id), await readableArtifactIdentity(owner, row.id)]).toEqual([null, null, null, null]);
  });

  it('a token reads its own rows by token; an account\'s reach covers owned and editable rows, with share lists', async () => {
    const owner = await account('owner@example.test');
    const editor = await account('editor@example.test');
    const loose = await mintToken('loose', null);
    const tokenRow = await createArtifact(loose.id, null, page('Token'));
    expect(await getArtifact(loose.id, tokenRow.id)).toMatchObject({ id: tokenRow.id });
    expect(await getArtifact('other-token', tokenRow.id)).toBeNull();
    const a = await mine(owner, 'A');
    const b = await mine(owner, 'B');
    expect(await hasInvitedUsersFor(owner, a.id)).toBe(false);
    await updateSharingFor(owner, a.id, { shares: [{ email: 'editor@example.test', role: 'editor' }] });
    expect(await hasInvitedUsersFor(owner, a.id)).toBe(true);
    expect(await hasInvitedUsersFor(editor, b.id)).toBe(false);
    expect((await getArtifactFor(editor, a.id))!.shares).toEqual([{ email: 'editor@example.test', role: 'editor' }]);
    expect(await getOwnedArtifactFor(editor, a.id)).toBeNull();
    expect((await getArtifactsFor(owner, [a.id, b.id, tokenRow.id])).map(r => r.id).sort()).toEqual([a.id, b.id].sort());
    expect((await getArtifactsFor(editor, [a.id, b.id])).map(r => r.id)).toEqual([a.id]);
    expect(await getArtifactsFor(owner, [])).toEqual([]);
    expect((await getEditableArtifactFor(editor, a.id))!.id).toBe(a.id);
    expect(await getEditableArtifactFor(editor, b.id)).toBeNull();
  });

  it('the link-readable cut: never private, and a governed dataset by its read grant', async () => {
    const owner = await account('owner@example.test');
    const priv = await mine(owner, 'Private');
    const open = await mine(owner, 'Open');
    await updateSharingFor(owner, open.id, { visibility: 'unlisted' });
    const ownerOnly = await dataset(owner, { version: 2, allow: [{ actions: ['read'], from: { user: '$owner' } }] });
    const everyone = await dataset(owner, { version: 2, allow: [{ actions: ['read'], from: { user: '*' } }] });
    expect(await getLinkReadableArtifact(priv.id)).toBeNull();
    expect(await getLinkReadableArtifact(open.id)).toMatchObject({ id: open.id });
    expect(await getLinkReadableArtifact(ownerOnly.id)).toBeNull();
    expect((await getLinkReadableArtifacts([priv.id, open.id, ownerOnly.id, everyone.id])).map(r => r.id).sort()).toEqual([open.id, everyone.id].sort());
    expect(await getLinkReadableArtifacts([])).toEqual([]);
  });

  it('accessMoved notices every access column and nothing else', async () => {
    const owner = await account('owner@example.test');
    const header = (await getArtifactHeaderById((await mine(owner)).id))!;
    expect(accessMoved(header, { ...header, title: 'renamed', version: 9 })).toBe(false);
    for (const change of [{ visibility: 'public' }, { link_role: 'editor' }, { user_id: 'x' }, { group_id: 'g' }, { token_id: 't' }, { sharing_revision: 4 }] as const)
      expect(accessMoved(header, { ...header, ...change } as typeof header)).toBe(true);
  });
});

describe('reader admission', () => {
  it('a readable row carries the reader\'s role; a dataset grant admits a reader with no role', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const row = await mine(owner);
    expect(await readableArtifact(stranger, row.id)).toBeNull();
    expect(await readableArtifactHeader(stranger, row.id)).toBeNull();
    await updateSharingFor(owner, row.id, { visibility: 'unlisted', linkRole: 'commenter' });
    expect((await readableArtifact(stranger, row.id))!.role).toBe('commenter');
    expect(await readableArtifactHeader(stranger, row.id)).toMatchObject({ role: 'commenter', row: { id: row.id } });
    const data = await dataset(owner, { version: 2, allow: [{ actions: ['read'], from: { user: '*' } }] });
    await updateSharingFor(owner, data.id, { linkRole: 'viewer' });
    await sql("UPDATE artifacts SET visibility='unlisted' WHERE id=$1", [data.id]);
    expect((await readableArtifact(stranger, data.id))!.role).toBe('viewer');
    expect(await readableArtifact(stranger, 'missing')).toBeNull();
  });

  it('the snapshot: an editor reads the head it edits; a reader\'s wire loses governance and gets its capabilities', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const row = await mine(owner);
    expect(await snapshotHeadFor(stranger, row.id)).toBeNull();
    await updateSharingFor(owner, row.id, { visibility: 'unlisted' });
    expect(await snapshotHeadFor(owner, row.id)).toMatchObject({ role: 'owner', snapshot: { id: row.id, shares: [] } });
    const read = (await snapshotHeadFor(stranger, row.id))!;
    expect(read.role).toBe('viewer');
    expect(read.snapshot).not.toHaveProperty('shares');
    const wire = { id: row.id, shares: [], dataset_policy: {}, policy_revision: 1, sharing_revision: 1, actor_user_id: 'u', actor_token_id: 't', markup: 'm', meta: { secret: 1 } };
    const forReader = snapshotForReader({ ...wire }, read.row as ArtifactRow, 'viewer');
    expect(Object.keys(forReader).sort()).toEqual(['capabilities', 'id', 'markup', 'meta']);
    expect(forReader.capabilities).toEqual({ comment_receipts: true, mutation_receipts: true, read: true, edit: false, comment: false, sharing: false, delete: false, restore: false });
    const data = await dataset(owner);
    expect(snapshotForReader({ ...wire }, data, 'commenter')).toMatchObject({ markup: null, meta: { catalog: null }, capabilities: { comment: true } });
    expect(snapshotForReader({ ...wire }, data, 'owner')).toMatchObject({ shares: [], markup: 'm', capabilities: { edit: true, delete: true, restore: true } });
  });
});

describe('what is served', () => {
  it('retired shapes are refused by name, as a 410 at the door', async () => {
    expect(unservable({ format: 'html', version: 3, source: '  ' })).toMatchObject({ status: 410, reason: 'unreadable', version: 3 });
    expect(unservable({ format: 'html', version: 1, source: '<p>x</p>' })).toBeNull();
    expect(unservable({ format: 'markup', version: 2, source: '<Doc/>', document: { kind: 'graph' }, meta: {} })).toMatchObject({ reason: 'data_syntax' });
    expect(unservable({ format: 'markup', version: 2, source: null })).toMatchObject({ reason: 'unreadable' });
    expect(unservable({ format: 'dataset', version: 1 })).toBeNull();
    const row = { format: 'image', version: 1 };
    expect(servableDocument(row)).toBe(row);
    expect(() => servableDocument({ format: 'html', version: 2, source: '' })).toThrow(UnservableDocument);
    const refused = await refusingUnservable(async () => { servableDocument({ format: 'html', version: 2, source: '' }); return new Response('ok'); }, { 'x-test': '1' });
    expect([refused.status, refused.headers.get('x-test'), (await refused.json()).error]).toEqual([410, '1', 'unservable_document']);
    expect((await refusingUnservable(async () => new Response('ok'))).status).toBe(200);
    await expect(refusingUnservable(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('?version=N: history readers and a verified capture see an archived version; everyone else the uniform 404', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const v1 = await mine(owner, 'First');
    const v2 = await replaceArtifactFor(owner, v1.id, page('Second'), { expectedVersion: v1.version }) as ArtifactRow;
    const at = (v: string) => new Request(`https://app.test/a/${v1.id}?${VERSION_PARAM}=${v}`);
    const as = (actor: typeof owner) => async () => actor;
    expect(VERSION_PARAM).toBe('version');
    expect(await archivedVersionFor(new Request(`https://app.test/a/${v1.id}`), v2, as(owner))).toBeNull();
    expect(await archivedVersionFor(at('1e3'), v2, as(owner))).toBe('not_found');
    expect(await archivedVersionFor(at('1'), v2, as(owner))).toMatchObject({ version: 1, head: 2, title: 'First', source: v1.source });
    expect(await archivedVersionFor(at('2'), v2, as(owner))).toMatchObject({ version: 2, head: 2, title: 'Second' });
    expect(await archivedVersionFor(at('1'), v2, as(stranger))).toBe('not_found');
    expect(await archivedVersionFor(at('1'), v2, as(stranger), { capture: true })).toMatchObject({ version: 1, title: 'First' });
    expect(await archivedVersionFor(at('7'), v2, as(owner), { capture: true })).toBe('not_found');
    expect(await archivedVersionForActor(identityForUser(null, null), v2, 1)).toBe('not_found');
    expect(await archivedVersionForActor(owner, v2, 0)).toBe('not_found');
    expect(await archivedVersionForActor(owner, { ...v2, format: 'dataset' }, 1)).toBe('not_found');
    const archived = await archivedVersionForActor(owner, v2, 1);
    expect(servedRow(v2, archived === 'not_found' ? null : archived)).toMatchObject({ id: v1.id, title: 'First', source: v1.source, version: 2 });
    expect(servedRow(v2, null)).toBe(v2);
  });

  it('an image reference resolves for its readers only; a view is admitted for a readable page', async () => {
    const owner = await account('owner@example.test');
    const stranger = await account('stranger@example.test');
    const image = await createArtifact(null, owner.userId, { format: 'image', source: null, meta: { width: 4, height: 3 }, title: 'Pic', visibility: 'private' });
    expect(await resolveImageReference(`ref:${image.id}`, owner)).toMatchObject({ kind: 'image', width: 4, height: 3 });
    expect(await resolveImageReference(`ref:${image.id}`, stranger)).toBeNull();
    expect(await resolveImageReference(image.id, owner)).toBeNull();
    const doc = await mine(owner);
    expect(await resolveImageReference(`ref:${doc.id}`, owner)).toBeNull();
    const view = (id: string, headers: Record<string, string> = {}, query = '') => new Request(`https://app.test/api/page/artifact/${id}/view${query}`, { method: 'POST', headers });
    const views = async () => { await flushViews(); return (await sql<{ n: number }>("SELECT count(*)::int AS n FROM analytics_events WHERE event='view'"))[0]!.n; };
    expect(await recordArtifactView(view(doc.id, { 'sec-fetch-site': 'cross-site' }), doc.id, async () => owner)).toBe('forbidden');
    expect(await recordArtifactView(view(doc.id), doc.id, async () => stranger)).toBe('not_found');
    expect(await recordArtifactView(view(image.id), image.id, async () => owner)).toBe('not_found');
    expect(await recordArtifactView(view(doc.id, {}, '?key=capture'), doc.id, async () => owner)).toBe('accepted');
    expect(await views()).toBe(0);
    expect(await recordArtifactView(view(doc.id), doc.id, async () => owner)).toBe('accepted');
    expect(await views()).toBe(1);
    expect((await head(doc.id)).id).toBe(doc.id);
  });
});
