/**
 * WHO CHANGES WHO REACHES AN ARTIFACT (lib/artifact-access `sharingScope` / `managesSharing`): every writer of
 * visibility, link role, the share list, dataset access and dataset policy, asked by every kind of editor. The owner,
 * a named editor, a group's sign-in at Editor on its own pages may; an editor by LINK, the host's
 * document-editor grant and a viewer get the uniform miss, the answer a stranger gets. A link editor's ordinary save
 * that carries the current settings back is still a save, and naming themselves an editor is refused at every door.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { admitGroupMember, request, testPagesSite, useAppHarness } from '@/__tests__/harness';
import { account, readAllPolicy, type Account } from '@/__tests__/artifact-fixtures';
import { artifactState, changeMembership, createArtifact, getArtifactById, getSharingFor, isVersionConflict, membershipState, replaceArtifactFor, setMetadataFor, updateSharingFor, type ArtifactRow } from '@/lib/artifacts';
import { managesSharing, sharingScope, type ArtifactRow as Row } from '@/lib/artifact-access';
import { readDatasetPermissions, writeDatasetPermissions } from '@/lib/dataset-access';
import { createGroup } from '@/lib/groups';
import { getDb } from '@/lib/platform';
import { Reply } from '@/lib/http';
import type { AccessActor } from '@/lib/accounts';
import { setDocumentEditorPolicy } from '@/lib/authentication';
import { artifactPageAnswer } from '@/lib/document-serving';

useAppHarness();

const CALLERS = ['owner', 'named editor', 'group member', 'group sign-in at editor', 'link editor', 'document editor', 'viewer'] as const;
type Caller = (typeof CALLERS)[number];
const MANAGES: readonly Caller[] = ['owner', 'named editor', 'group sign-in at editor'];

const sql = async (text: string, values: unknown[] = []) => (await (await getDb()).query(text, values)).rows;
const head = async (id: string): Promise<ArtifactRow> => (await getArtifactById(id))!;
const username = (person: Account, name: string) => sql('UPDATE users SET username=$2 WHERE id=$1', [person.userId, name]);

/** One artifact of `format` and the actor who asks as `caller`: each case its own row, so no case sees another's write. */
let made = 0;
async function subject(caller: Caller, format: 'html' | 'dataset'): Promise<{ row: ArtifactRow; actor: AccessActor; self: Account }> {
  const n = ++made, owner = await account(`mxmx_test_sa_owner${n}@example.com`), other = await account(`mxmx_test_sa_other${n}@example.com`);
  const content = format === 'html'
    ? { format: 'html' as const, source: nativeHtml('<p data-af-id="root">shared</p>'), meta: {}, title: 'Shared' }
    : { format: 'dataset' as const, source: null, meta: {}, title: 'Data', access: 'readwrite' as const };
  if (caller === 'group member' || caller === 'group sign-in at editor') {
    const team = await createGroup(owner.userId, { handle: `sa_team${n}`, name: 'Team' });
    await admitGroupMember(owner.userId, team.id, other.userId, 'member');
    const row = await createArtifact(null, owner.userId, { ...content, visibility: 'private', destination: { type: 'group', id: team.id } });
    const actor: AccessActor = caller === 'group member' ? other
      : { userId: null, tokenId: null, email: null, documentEditor: false, principalGroup: { id: team.id, role: 'editor', tokenId: 'tok_sa_group_sign_in', issuedBy: owner.userId } };
    return { row: await head(row.id), actor, self: other };
  }
  const visibility = caller === 'link editor' || caller === 'document editor' ? 'unlisted' : 'private';
  const row = await createArtifact(null, owner.userId, { ...content, visibility }, caller === 'link editor' ? { linkRole: 'editor' } : {});
  if (caller === 'named editor' || caller === 'viewer') await updateSharingFor(owner, row.id, { shares: [{ email: other.email!, role: caller === 'viewer' ? 'viewer' : 'editor' }] });
  const actor = caller === 'owner' ? owner : caller === 'document editor' ? { ...other, documentEditor: true } : other;
  return { row: await head(row.id), actor, self: other };
}

const landed = (result: unknown) => !!result && !(result instanceof Reply) && !isVersionConflict(result as ArtifactRow);

/** Each writer makes one access change as `actor` and says whether it landed. */
const WRITERS: Array<[string, 'html' | 'dataset', (actor: AccessActor, row: ArtifactRow, self: Account) => Promise<boolean>]> = [
  ['the Share dialog (updateSharingFor): the link role', 'html', async (actor, row) => !!await updateSharingFor(actor, row.id, { linkRole: 'commenter' })],
  ['metadata PATCH (setMetadataFor): the visibility', 'html', async (actor, row) => landed(await setMetadataFor(actor, row.id, { visibility: row.visibility === 'private' ? 'unlisted' : 'private' }, { expectedState: artifactState(row), allowEditor: true }))],
  ['the content replace (replaceArtifactFor): the link role', 'html', async (actor, row) => landed(await replaceArtifactFor(actor, row.id, { ...row, link_role: 'commenter', source: row.source!.replace('shared', 'edited') }, { expectedVersion: row.version, expectedState: artifactState(row) }))],
  ['the Share dialog (updateSharingFor): dataset access', 'dataset', async (actor, row) => !!await updateSharingFor(actor, row.id, { access: 'read' })],
  ['the policy door (PUT /policy)', 'dataset', async (actor, row) => (await writeDatasetPermissions(actor, row.id, { policy: readAllPolicy(), expectedPolicyRevision: row.policy_revision ?? 0 })).status === 200],
  ['metadata PATCH (setMetadataFor): the policy', 'dataset', async (actor, row) => landed(await setMetadataFor(actor, row.id, { policy: readAllPolicy() as never }, { expectedState: artifactState(row), expectedPolicyRevision: row.policy_revision ?? 0, allowEditor: true }))],
];

describe('every writer of who reaches an artifact, asked by every kind of editor', () => {
  it.each(WRITERS.flatMap(([writer, format, write]) => CALLERS.map((caller) => [writer, caller, format, write] as const)))('%s, by the %s', async (_writer, caller, format, write) => {
    const { row, actor, self } = await subject(caller, format);
    const before = await head(row.id);
    expect(await write(actor, row, self)).toBe(MANAGES.includes(caller));
    if (!MANAGES.includes(caller)) {
      const after = await head(row.id);
      expect([after.visibility, after.link_role, after.access, after.dataset_policy, after.sharing_revision, after.policy_revision], 'a refusal changes nothing')
        .toEqual([before.visibility, before.link_role, before.access, before.dataset_policy, before.sharing_revision, before.policy_revision]);
    }
  });

  it.each(CALLERS)('the %s: the SQL scope and the JavaScript rule agree on who manages sharing', async (caller) => {
    for (const format of ['html', 'dataset'] as const) {
      const { row, actor } = await subject(caller, format);
      const scope = sharingScope(actor);
      const sqlSays = (await sql(`SELECT 1 FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`, [row.id, scope.val])).length === 1;
      expect([sqlSays, await managesSharing(row as Row, actor)], format).toEqual([MANAGES.includes(caller), MANAGES.includes(caller)]);
    }
  });

  it.each(CALLERS.filter((caller) => caller !== 'group sign-in at editor'))('including viewing access with an invitation, by the %s', async (caller) => {
    const { row, actor } = await subject(caller, 'html');
    const invitee = await account('mxmx_test_sa_invitee@example.com');
    await username(invitee, 'sa_invitee');
    if (actor.userId) await sql('UPDATE users SET username=$2 WHERE id=$1 AND username IS NULL', [actor.userId, 'sa_inviter']);
    const invited = changeMembership(actor, row.id, { action: 'invite', usernames: ['@sa_invitee'], includeAccess: true });
    if (MANAGES.includes(caller)) await invited;
    else await expect(invited).rejects.toThrow(/owners and editors|participate|not found/i);
    expect((await sql('SELECT 1 FROM artifact_shares WHERE artifact_id=$1 AND email=$2', [row.id, invitee.email])).length).toBe(MANAGES.includes(caller) ? 1 : 0);
  });
});

describe('an editor by link alone', () => {
  it('keeps every ordinary save, including one that carries the current visibility and link role back', async () => {
    const { row, actor } = await subject('link editor', 'html');
    const saved = await replaceArtifactFor(actor, row.id, { ...row, link_role: row.link_role ?? undefined, source: row.source!.replace('shared', 'edited') }, { expectedVersion: row.version, expectedState: artifactState(row) });
    expect(landed(saved), JSON.stringify(saved)).toBe(true);
    const renamed = await setMetadataFor(actor, row.id, { title: 'Renamed', visibility: 'unlisted', link_role: 'editor' }, { expectedState: artifactState(await head(row.id)), allowEditor: true });
    expect(landed(renamed), JSON.stringify(renamed)).toBe(true);
    expect(await head(row.id)).toMatchObject({ title: 'Renamed', visibility: 'unlisted', link_role: 'editor' });
  });

  it('cannot name themselves an editor through any door, so the owner turning the link back leaves them nothing', async () => {
    const { row, actor, self } = await subject('link editor', 'html');
    const shares = [{ email: self.email!, role: 'editor' as const }];
    expect(await updateSharingFor(actor, row.id, { shares })).toBeNull();
    expect(await setMetadataFor(actor, row.id, { shares }, { expectedState: artifactState(row), allowEditor: true })).toBeNull();
    expect(await replaceArtifactFor(actor, row.id, { ...row, link_role: row.link_role ?? undefined }, { expectedVersion: row.version, expectedState: artifactState(row), shares })).toBeNull();
    expect(await sql('SELECT email FROM artifact_shares WHERE artifact_id=$1', [row.id])).toEqual([]);
  });

  it('reads the sharing, the policy and its dry run, told it may change none of it', async () => {
    for (const caller of ['link editor', 'named editor'] as const) {
      const page = await subject(caller, 'html');
      expect(await getSharingFor(page.actor, page.row.id), caller).toMatchObject({ canManageSharing: caller === 'named editor' });
      expect((await membershipState(page.actor, page.row.id)).canShare, caller).toBe(caller === 'named editor');
      const data = await subject(caller, 'dataset');
      expect(await readDatasetPermissions(data.actor, data.row.id), caller).toMatchObject({ status: 200, body: { canSave: caller === 'named editor' } });
      expect((await writeDatasetPermissions(data.actor, data.row.id, { policy: readAllPolicy(), dryRun: true })).status, caller).toBe(200);
    }
  });
});

/** The page answer every page boots from (and reloads after an access change): who is offered the Sharing action. */
describe('the page answer says who manages sharing', () => {
  afterEach(() => setDocumentEditorPolicy());
  const site = testPagesSite('pages.example.test', 'http://localhost:3000');
  it.each(CALLERS.filter((caller) => caller !== 'group sign-in at editor'))('the %s', async (caller) => {
    for (const format of ['html', 'dataset'] as const) {
      const { row, actor } = await subject(caller, format);
      setDocumentEditorPolicy((asked) => caller === 'document editor' && asked.userId === actor.userId && asked.emailVerified === true);
      const session = { credential: 'session' as const, userId: actor.userId!, email: actor.email!, emailVerified: true };
      const answer = await artifactPageAnswer(request(`/a/${row.id}`, { actor: session }), row.id, { pages: site });
      expect(answer.status, `${format}: ${JSON.stringify(answer.body)}`).toBe(200);
      const body = answer.body as { canManageSharing?: boolean; role?: string };
      // Every editor here holds edit access on the page; only those who manage sharing are offered it.
      if (format === 'html' && caller !== 'viewer' && caller !== 'group member') expect(body.role, format).toMatch(/^(owner|editor)$/);
      expect(body.canManageSharing, format).toBe(MANAGES.includes(caller));
    }
  });
});
