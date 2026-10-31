/**
 * THE WIRE through the interface: the body parsers every write door shares, the read and write echoes (summary,
 * full row, create and replace replies, an archived version), placement from a wire `parent_id`, and the
 * metadata PATCH from a request body.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { ALLOW_PUBLIC_VISIBILITY } from '@/lib/platform';
import { flushViews } from '@/lib/analytics';
import { SUMMARY_META_FIELDS, artifactSummaryToWire, artifactToWire, committedOpenAnnotations, createdArtifactWire, monitoringGuidance, parseAccessValue, parseExpectedVersion, parseLinkRoleValue, parseParentField, parseShareEntries, parseVisibilityValue, placementFor, recordArtifactView, replacedArtifactWire, resolveImageReference, sourceRepairsEcho, updateMetadataFromBody, versionToWire } from '@/lib/artifact-wire';
import { artifactState, createArtifact, getArtifactFor, listArtifactPageFor, updateSharingFor, getVersionFor, replaceArtifactFor } from '@/lib/artifacts';
import { type ArtifactRow } from '@/lib/artifact-access';
import { account, dataset, head, mine, page, sql } from '@/__tests__/artifact-fixtures';

useAppHarness();
const BASE = 'https://app.test';
const refusal = async (value: unknown) => value instanceof Response ? [value.status, (await value.json()).error] : value;

describe('body parsers', () => {
  it('each field: absent keeps, a valid value passes, anything else is refused by name', async () => {
    const state = 'a'.repeat(64);
    expect(parseExpectedVersion({ expectedVersion: 2, expectedState: state })).toEqual({ expectedVersion: 2, expectedState: state });
    expect(parseExpectedVersion({ expectedState: state }, false)).toEqual({ expectedState: state });
    expect(await refusal(parseExpectedVersion({ expectedState: state }))).toEqual([400, 'version_required']);
    expect(await refusal(parseExpectedVersion({ expectedVersion: 0, expectedState: state }))).toEqual([400, 'invalid_expected_version']);
    expect(await refusal(parseExpectedVersion({ expectedVersion: 1, expectedState: 'x' }))).toEqual([400, 'invalid_expected_state']);
    expect(await refusal(parseExpectedVersion({ expectedVersion: 1 }))).toEqual([400, 'state_required']);
    expect(parseParentField({})).toBeUndefined();
    expect(parseParentField({ parent_id: null })).toBeNull();
    expect(parseParentField({ parent_id: 'Abc123' })).toBe('Abc123');
    expect(await refusal(parseParentField({ parent_id: '../x' }))).toEqual([400, 'invalid_parent']);
    expect(await refusal(parseParentField({ folder: 'a/b' }))).toEqual([400, 'folder_retired']);
    expect(parseVisibilityValue(undefined, true)).toBeUndefined();
    expect(parseVisibilityValue('private', true)).toBe('private');
    expect(await refusal(parseVisibilityValue('private', false))).toEqual([400, 'private_requires_account']);
    expect(await refusal(parseVisibilityValue('secret', true))).toEqual([400, 'invalid_visibility']);
    expect(await refusal(parseVisibilityValue('public', true))).toEqual(ALLOW_PUBLIC_VISIBILITY ? 'public' : [400, 'public_not_enabled']);
    expect(parseLinkRoleValue('')).toBeUndefined();
    expect(parseLinkRoleValue('commenter')).toBe('commenter');
    expect(await refusal(parseLinkRoleValue('owner'))).toEqual([400, 'invalid_link_role']);
    expect(parseAccessValue('readwrite', 'dataset')).toBe('readwrite');
    expect(parseAccessValue(undefined, 'html')).toBeUndefined();
    expect(await refusal(parseAccessValue('readwrite', 'html'))).toEqual([400, 'access_datasets_only']);
    expect(await refusal(parseAccessValue('all', 'dataset'))).toEqual([400, 'invalid_access']);
    expect(parseShareEntries(undefined)).toBeUndefined();
    expect(parseShareEntries([{ email: 'a@example.test', role: 'viewer' }])).toEqual([{ email: 'a@example.test', role: 'viewer' }]);
    expect(await refusal(parseShareEntries([{ email: 'a@example.test', role: 'owner' }]))).toEqual([400, 'invalid_shares']);
    expect(sourceRepairsEcho(undefined)).toEqual({});
    expect(sourceRepairsEcho([{ kind: 'x' } as never])).toEqual({ source_repairs: [{ kind: 'x' }] });
    expect(committedOpenAnnotations({ open_annotations: 3 } as ArtifactRow)).toBe(3);
    expect(committedOpenAnnotations({} as ArtifactRow)).toBe(0);
    expect(monitoringGuidance('https://app.test/', 'Abc123', 'image')).toEqual({});
    expect(monitoringGuidance('https://app.test/', 'Abc123', 'markup')).toMatchObject({ monitoring: { artifact_url: 'https://app.test/a/Abc123', guide: 'https://app.test/llms/html-operations#watch-for-comments', http: expect.stringContaining('/api/artifacts/Abc123/annotations/changes') } });
  });

  it('placement from a wire parent: absent leaves it, a non-owner is refused, a folder files', async () => {
    const owner = await account('owner@example.test');
    const box = await createArtifact(null, owner.userId, { format: 'folder', source: null, meta: {}, title: 'Box' });
    expect(await placementFor(owner, undefined, null)).toBeUndefined();
    expect(await placementFor(owner, box.id, null)).toEqual({ ancestor_ids: [box.id] });
    expect(await refusal(await placementFor(owner, box.id, null, false))).toEqual([400, 'invalid_parent']);
    expect(await refusal(await placementFor(owner, 'Nope12', null))).toEqual([400, 'invalid_parent']);
  });
});

describe('echoes', () => {
  it('a summary is an index: narrowed meta, placement halves, no owner columns', async () => {
    const owner = await account('owner@example.test');
    await mine(owner, 'Doc', { meta: { theme: 'paper', objectKey: 'secret' } });
    const [summary] = (await listArtifactPageFor(owner, 5)).rows;
    const wire = artifactSummaryToWire({ ...summary!, views: 4 }, BASE);
    expect(wire).toMatchObject({ url: `${BASE}/a/${summary!.id}`, parent_id: null, ancestor_ids: [], views: 4, meta: {} });
    expect(Object.keys(wire)).not.toContain('user_id');
    expect(SUMMARY_META_FIELDS.dataset).toContain('rowCount');
    expect(artifactSummaryToWire({ ...summary!, format: 'image', meta: { bytes: 9, objectKey: 'k' } }, BASE).meta).toEqual({ bytes: 9 });
  });

  it('a full read drops ownership and trash columns, states the row, and gives datasets their ACL and rows', async () => {
    const owner = await account('owner@example.test');
    const row = await mine(owner);
    const wire = await artifactToWire(row, BASE, 2);
    expect(wire).toMatchObject({ id: row.id, html: row.source, state: artifactState(row), owner: { type: 'personal' }, parent_id: null });
    for (const hidden of ['token_id', 'user_id', 'deleted_at', 'access', 'markup']) expect(wire[hidden as keyof typeof wire]).toBeUndefined();
    expect((await artifactToWire(row, BASE, 2, false)).state).toBe('');
    const data = await dataset(owner);
    expect(await artifactToWire(data, BASE, 0)).toMatchObject({ access: 'readwrite', rowCount: 0, columns: [], rows: [] });
  });

  it('create and replace replies hand back the next edit\'s inputs; an archived version carries its bytes', async () => {
    const owner = await account('owner@example.test');
    const row = await mine(owner);
    expect(createdArtifactWire(row, BASE, row.source)).toMatchObject({ id: row.id, edit_id: row.edit_id, state: artifactState(row), html: row.source, link_role: 'viewer', ancestor_ids: [], sharing_revision: 0 });
    const markupRow = { ...row, format: 'markup' as const, source: '<p>stored</p>' };
    expect(createdArtifactWire(markupRow, BASE, '<p>stored</p>')).toMatchObject({ markup_changed: false });
    expect(createdArtifactWire(markupRow, BASE, '<p>sent</p>')).toMatchObject({ markup_changed: true, markup: '<p>stored</p>' });
    expect(createdArtifactWire(markupRow, BASE, undefined)).toMatchObject({ markup: '<p>stored</p>' });
    const next = await replaceArtifactFor(owner, row.id, page('Two'), { expectedVersion: 1 }) as ArtifactRow;
    const replaced = await replacedArtifactWire(next, BASE, undefined, { affected: [row], warnings: [{ id: 'w', title: null, details: ['x'] }], openAnnotations: 1 });
    expect(replaced).toMatchObject({ version: 2, edit_id: next.edit_id, affected_dependents: [{ id: row.id, title: 'Doc' }], warnings: [{ id: 'w' }], shares: [] });
    expect(await replacedArtifactWire(next, BASE, undefined, { affected: null, warnings: [], openAnnotations: 0 })).not.toHaveProperty('warnings');
    const version = (await getVersionFor(owner, row.id, 1))!;
    expect(versionToWire(version)).toMatchObject({ version: 1, html: row.source });
    expect(versionToWire({ ...version, format: 'markup' })).toMatchObject({ markup: row.source });
  });
});

describe('route adapters', () => {
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

describe('the metadata PATCH from a body', () => {
  it('validates every field before writing, keeps placement the owner\'s, and dry-runs without writing', async () => {
    const owner = await account('owner@example.test');
    const editor = await account('editor@example.test');
    const row = await mine(owner);
    await updateSharingFor(owner, row.id, { shares: [{ email: 'editor@example.test', role: 'editor' }] });
    const current = (await getArtifactFor(owner, row.id))!;
    const state = artifactState(current);
    const patch = async (actor: typeof owner, body: Record<string, unknown>, dryRun = false) => {
      const reply = await updateMetadataFromBody(actor, row.id, body, BASE, dryRun);
      return [reply.status, await reply.json()] as const;
    };
    expect((await patch(owner, { html: '<p/>', source: 'x' }))[1].error).toBe('native_html_required');
    expect((await patch(await account('stranger@example.test'), { expectedState: state, title: 'x' }))[0]).toBe(404);
    expect((await patch(owner, { title: 'x' }))[1].error).toBe('state_required');
    expect((await patch(owner, { expectedState: state, colour: 'red' }))[1].error).toBe('invalid_metadata');
    expect((await patch(owner, { expectedState: state }))[1].error).toBe('empty_metadata');
    expect((await patch(owner, { expectedState: state, theme: 'nope' }))[1].error).toBe('unknown_theme');
    expect((await patch(owner, { expectedState: state, colorMode: 'blue' }))[1].error).toBe('unknown_color_mode');
    expect((await patch(owner, { expectedState: state, visibility: null }))[1].error).toBe('invalid_metadata');
    expect((await patch(owner, { expectedState: state, expectedPolicyRevision: 1, title: 'x' }))[1]).toMatchObject({ error: 'invalid_metadata', field: 'expectedPolicyRevision' });
    expect((await patch(editor, { expectedState: state, parent_id: null }))).toEqual([403, { error: 'owner_only' }]);
    expect((await patch(owner, { expectedState: 'b'.repeat(64), title: 'x' }))[0]).toBe(409);
    expect(await patch(editor, { expectedState: state, title: 'Dry' }, true)).toEqual([200, { valid: true, dry_run: true, state, commit_checks: ['authorization', 'observed_state'] }]);
    expect((await head(row.id)).title).toBe('Doc');
    const [status, wire] = await patch(editor, { expectedState: state, title: 'By editor', linkRole: 'commenter' });
    expect([status, wire.title, wire.link_role]).toEqual([200, 'By editor', 'commenter']);
  });
});
