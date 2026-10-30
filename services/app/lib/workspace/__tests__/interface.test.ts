/**
 * lib/workspace's interface and declared leaves, against a seeded inventory: the dashboard core (own documents, the
 * documents shared to the account's email, a group only for its members), the signed-out and personal home, the
 * asset browser's filters and page clamping, owned listings (deleted rows excluded), the account's token history,
 * the like readout, and the pure leaves (starters, sharing icons, the parent of a row, the JSX preview).
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { createUser, mintToken } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { link } from '@/lib/social';
import {
  accountWorkspaceCoreFor, artifactStarter, formatJsxPreview, homeBootstrapFor, likeSummaryByUser, listAccountTokenRows, listOwnedArtifacts,
  workspaceAssetsFor,
} from '@/lib/workspace';
import { ARTIFACT_STARTERS } from '@/lib/workspace/artifact-starters';
import { parentOfRow } from '@/lib/workspace/shelf';
import { VISIBILITY_ICON_NODES, sharingIconFor } from '@/lib/workspace/visibility-icons';

useAppHarness();

type Row = { id: string; user: string; token: string; format?: string; title?: string; visibility?: string; deleted?: boolean; group?: string; at?: string };
async function artifact({ id, user, token, format = 'html', title = id, visibility = 'private', deleted = false, group, at = '2026-10-01T00:00:00Z' }: Row) {
  await (await getDb()).query(
    'INSERT INTO artifacts (id, user_id, token_id, format, title, visibility, group_id, updated_at, deleted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, user, token, format, title, visibility, group ?? null, at, deleted ? at : null],
  );
}
async function owner(name: string) {
  const user = await createUser({ email: `${name}@example.test` });
  return { id: user.id, token: (await mintToken(`${name}-cli`, user.id)).id };
}

describe('the dashboard core', () => {
  it('lists the owner\'s live documents and folders newest first, and what is shared to their email but not their own', async () => {
    const alice = await owner('alice'), bob = await owner('bob');
    await artifact({ id: 'doc_old', user: alice.id, token: alice.token, at: '2026-09-01T00:00:00Z' });
    await artifact({ id: 'doc_new', user: alice.id, token: alice.token, at: '2026-10-01T00:00:00Z' });
    await artifact({ id: 'fold_1', user: alice.id, token: alice.token, format: 'folder' });
    await artifact({ id: 'csv_1', user: alice.id, token: alice.token, format: 'dataset' });
    await artifact({ id: 'doc_gone', user: alice.id, token: alice.token, deleted: true });
    await artifact({ id: 'bob_doc', user: bob.id, token: bob.token, title: 'For Alice' });
    await artifact({ id: 'bob_gone', user: bob.id, token: bob.token, deleted: true });
    const db = await getDb();
    for (const id of ['bob_doc', 'bob_gone', 'doc_new']) await db.query("INSERT INTO artifact_shares (artifact_id, email, role) VALUES ($1, 'alice@example.test', 'editor')", [id]);
    const core = (await accountWorkspaceCoreFor(alice.id, ' Alice@Example.test '))!;
    expect(core.artifacts.map(a => a.id).sort()).toEqual(['doc_new', 'doc_old', 'fold_1']);
    expect(core.artifacts.find(a => a.id === 'doc_new')).toMatchObject({ url: '/a/doc_new' });
    expect(core.shared).toEqual([expect.objectContaining({ id: 'bob_doc', title: 'For Alice', role: 'editor' })]);
    expect((await accountWorkspaceCoreFor(alice.id, null))!.shared).toEqual([]);
  });

  it('keeps older shared documents reachable behind more than 200 newer assets without widening access', async () => {
    const alice = await owner('alice'), bob = await owner('bob');
    await artifact({ id: 'older_document', user: bob.id, token: bob.token, at: '2026-09-01T00:00:00Z' });
    const db = await getDb();
    await db.query("INSERT INTO artifact_shares (artifact_id, email, role) VALUES ('older_document', 'alice@example.test', 'viewer')");
    for (let i = 0; i < 205; i++) {
      const id = `shared_asset_${i}`;
      await artifact({ id, user: bob.id, token: bob.token, format: i % 4 === 3 ? 'dataset' : 'file', title: `resource_${i}.${['css', 'js', 'woff2', 'csv'][i % 4]}` });
      await db.query("INSERT INTO artifact_shares (artifact_id, email, role) VALUES ($1, 'alice@example.test', 'editor')", [id]);
    }
    await artifact({ id: 'not_shared', user: bob.id, token: bob.token });
    await artifact({ id: 'deleted_shared', user: bob.id, token: bob.token, deleted: true });
    await db.query("INSERT INTO artifact_shares (artifact_id, email, role) VALUES ('deleted_shared', 'alice@example.test', 'viewer')");
    const core = (await accountWorkspaceCoreFor(alice.id, 'alice@example.test'))!;
    expect(core.shared).toHaveLength(206);
    expect(core.shared.some(row => row.id === 'older_document')).toBe(true);
    expect(core.shared.some(row => row.format === 'dataset' && row.role === 'editor')).toBe(true);
    expect(core.shared.some(row => ['not_shared', 'deleted_shared'].includes(row.id))).toBe(false);
  });

  it('answers null for a group the account does not belong to', async () => {
    const alice = await owner('alice');
    expect(await accountWorkspaceCoreFor(alice.id, null, 'grp_not_mine')).toBeNull();
  });
});

describe('the home bootstrap', () => {
  it('is signed-out without a user, and the personal shelf when asked for', async () => {
    expect(await homeBootstrapFor(null, { personal: false })).toMatchObject({ signedIn: false, deployment: expect.any(Object) });
    const alice = await owner('alice');
    await artifact({ id: 'doc_1', user: alice.id, token: alice.token });
    for (const personal of [true, false]) {
      const home = await homeBootstrapFor({ userId: alice.id, email: 'alice@example.test' }, { personal });
      expect(home).toMatchObject({ signedIn: true, accountId: alice.id, destination: { kind: 'personal', core: { artifacts: [expect.objectContaining({ id: 'doc_1' })] } } });
    }
  });
});

describe('the asset browser', () => {
  it('filters by text, format and visibility before paging, and clamps a page past the end', async () => {
    const alice = await owner('alice'), bob = await owner('bob');
    for (let i = 0; i < 52; i++) await artifact({ id: `csv_${String(i).padStart(2, '0')}`, user: alice.id, token: alice.token, format: 'dataset', title: `Sales ${i}`, at: `2026-10-01T00:${String(i).padStart(2, '0')}:00Z` });
    await artifact({ id: 'img_1', user: alice.id, token: alice.token, format: 'image', title: 'Logo', visibility: 'public' });
    await artifact({ id: 'img_gone', user: alice.id, token: alice.token, format: 'image', deleted: true });
    await artifact({ id: 'page_1', user: alice.id, token: alice.token, format: 'html' });
    await artifact({ id: 'fold_1', user: alice.id, token: alice.token, format: 'folder', title: 'Archive' });
    await artifact({ id: 'bob_img', user: bob.id, token: bob.token, format: 'image' });
    const all = await workspaceAssetsFor(alice.id, { page: 0, query: '', formats: [], visibilities: [] });
    expect([all.total, all.perPage, all.assets.length, all.page]).toEqual([53, 50, 50, 0]);
    expect(all.formats.sort()).toEqual(['dataset', 'image']);
    expect(all.visibilities.sort()).toEqual(['private', 'public']);
    expect(all.folders.map(f => f.id)).toEqual(['fold_1']);
    const last = await workspaceAssetsFor(alice.id, { page: 9, query: '', formats: [], visibilities: [] });
    expect([last.page, last.assets.length]).toEqual([1, 3]);
    expect((await workspaceAssetsFor(alice.id, { page: 0, query: ' LOGO ', formats: [], visibilities: [] })).assets.map(a => a.id)).toEqual(['img_1']);
    expect((await workspaceAssetsFor(alice.id, { page: 0, query: '', formats: ['image'], visibilities: [] })).total).toBe(1);
    expect((await workspaceAssetsFor(alice.id, { page: 0, query: '', formats: [], visibilities: ['public'] })).assets.map(a => a.url)).toEqual(['/a/img_1']);
    expect(await workspaceAssetsFor(bob.id, { page: 0, query: 'logo', formats: [], visibilities: [] })).toMatchObject({ total: 0, page: 0, assets: [] });
  });
});

describe('owned listings and tokens', () => {
  it('lists an owner\'s live ungrouped artifacts by user or by token, and every token with its live artifact count', async () => {
    const alice = await owner('alice');
    const second = await mintToken('second', alice.id);
    await artifact({ id: 'a1', user: alice.id, token: alice.token });
    await artifact({ id: 'a2', user: alice.id, token: second.id });
    await artifact({ id: 'a_gone', user: alice.id, token: alice.token, deleted: true });
    expect((await listOwnedArtifacts('user_id', alice.id)).map(a => a.id).sort()).toEqual(['a1', 'a2']);
    expect((await listOwnedArtifacts('token_id', second.id)).map(a => a.id)).toEqual(['a2']);
    expect(await listOwnedArtifacts('user_id', 'nobody')).toEqual([]);
    await (await getDb()).query('UPDATE tokens SET deleted_at = now() WHERE id = $1', [second.id]);
    const tokens = await listAccountTokenRows(alice.id);
    expect(tokens.map(t => [t.name, t.artifacts, t.deleted_at === null]).sort()).toEqual([['alice-cli', 1, true], ['second', 1, false]]);
    expect(await listAccountTokenRows('nobody')).toEqual([]);
  });
});

describe('the like readout', () => {
  it('counts live likes on the owner\'s live pages, by day, and nothing else', async () => {
    const alice = await owner('alice'), fan = await owner('fan');
    await artifact({ id: 'page_1', user: alice.id, token: alice.token });
    await artifact({ id: 'page_gone', user: alice.id, token: alice.token, deleted: true });
    await artifact({ id: 'data_1', user: alice.id, token: alice.token, format: 'dataset' });
    for (const id of ['page_1', 'page_gone', 'data_1']) await link(fan.id, 'like', id);
    const summary = await likeSummaryByUser(alice.id, 7);
    expect(summary.total).toBe(1);
    expect(summary.series).toHaveLength(7);
    expect(summary.series[6]).toBe(1);
    expect(await likeSummaryByUser(fan.id)).toMatchObject({ total: 0 });
  });
});

describe('the pure leaves', () => {
  it('starts each template private, titled for its kind and placed under its parent', () => {
    expect(ARTIFACT_STARTERS.map(s => s.template)).toContain('doc');
    expect(artifactStarter('doc')).toMatchObject({ visibility: 'private', parent_id: null, html: expect.stringContaining('<title>Untitled document</title>') });
    expect(artifactStarter('deck', 'fold_1')).toMatchObject({ parent_id: 'fold_1', html: expect.stringContaining('<h1>Untitled presentation</h1>') });
    expect(artifactStarter('nonexistent' as never).html).toContain('Untitled document');
  });

  it('shows a private document with invitees as shared, and has an icon for every state', () => {
    expect(sharingIconFor({ visibility: 'private', hasInvitedUsers: true })).toBe('shared');
    expect(sharingIconFor({ visibility: 'private', hasInvitedUsers: false })).toBe('private');
    expect(sharingIconFor({ visibility: 'public', hasInvitedUsers: true })).toBe('public');
    expect(Object.keys(VISIBILITY_ICON_NODES).sort()).toEqual(['private', 'public', 'shared', 'unlisted']);
  });

  it('reads a row\'s parent from either half of the wire', () => {
    expect(parentOfRow({ parent_id: 'p1', ancestor_ids: ['root', 'p2'] })).toBe('p1');
    expect(parentOfRow({ ancestor_ids: ['root', 'p2'] })).toBe('p2');
    expect(parentOfRow({ ancestor_ids: [] })).toBeNull();
    expect(parentOfRow({})).toBeNull();
  });

  it('formats JSX for display, keeping several roots and an empty source as it was', async () => {
    expect(await formatJsxPreview('  ')).toBe('  ');
    const formatted = await formatJsxPreview('<A x="1"><B/></A><C/>');
    expect(formatted).toContain('<A x="1">');
    expect(formatted).toContain('<C />');
    await expect(formatJsxPreview('<A>')).rejects.toThrow();
  });
});
