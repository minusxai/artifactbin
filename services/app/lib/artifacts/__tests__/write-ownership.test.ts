/**
 * THE WRITES OTHER MODULES ASK lib/artifacts AND lib/accounts TO MAKE. Each table is written by its owner
 * (scripts/ci/table-ownership.mjs); these pin what the callers observe of those writes: a dataset write's
 * head bump, archive, CAS and in-statement access guard; a policy write's revision, audit and conflict; a
 * token claim's and a guest merge's adoption of artifacts; and the inbox's auto-accept setting.
 */
import { describe, expect, it } from 'vitest';
import { artifactChannel } from '@artifactbin/contracts';
import { createGuestOwner, mintAccountToken, request, setDatasetPolicy, useAppHarness } from '@/__tests__/harness';
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { POST as create } from '@/app/api/artifacts/route';
import { claimToken, mergeGuestUsers } from '@/lib/authentication';
import { createUser, identityForUser } from '@/lib/accounts';
import { mintToken } from '@/lib/accounts/tokens';
import { createArtifact, getArtifactById } from '@/lib/artifacts';
import { isMutationRefused, mutateDataset } from '@/lib/document-data';
import { membershipInbox, updateMembershipInbox } from '@/lib/notifications';

const harness = useAppHarness();

async function dataset(access: 'read' | 'readwrite' = 'readwrite') {
  const owner = await mintAccountToken('write_ownership_owner');
  const reply = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: { dataset: [{ n: 1 }], access } }));
  expect(reply.status).toBe(201);
  const { id } = await reply.json() as { id: string };
  return { owner, actor: identityForUser(owner.userId, owner.id), row: (await getArtifactById(id))! };
}
const archived = async (id: string) => (await (await harness.db()).query<{ version: number }>('SELECT version FROM artifact_versions WHERE artifact_id=$1 ORDER BY version', [id])).rows.map(r => r.version);
async function heard(id: string): Promise<{ payloads: string[]; stop: () => Promise<void> }> {
  const payloads: string[] = [];
  const stop = await (await harness.db()).listen(artifactChannel(id), payload => payloads.push(payload));
  return { payloads, stop };
}

describe('a dataset write', () => {
  it('bumps the head, stamps the actor, archives the previous state once per window and notifies its channel', async () => {
    const { row, actor, owner } = await dataset();
    const channel = await heard(row.id);
    const first = await mutateDataset(row, actor, 'insert into rows (n) values (2)');
    if (isMutationRefused(first)) throw new Error(first.detail);
    expect(first.row).toMatchObject({ version: row.version + 1, actor_user_id: owner.userId, actor_token_id: owner.id });
    expect(first.row.edit_id).not.toBe(row.edit_id);
    expect(first).toMatchObject({ affected: 1, rowCount: 2 });
    const second = await mutateDataset(first.row, actor, 'insert into rows (n) values (3)');
    if (isMutationRefused(second)) throw new Error(second.detail);
    expect(second.row.version).toBe(row.version + 2);
    // Coalesced: the second write inside the snapshot window archives nothing new.
    expect(await archived(row.id)).toEqual([row.version]);
    await (await harness.db()).query('SELECT 1');
    expect(channel.payloads).toEqual([first.row.edit_id, second.row.edit_id]);
    await channel.stop();
  });

  it('a writer holding a stale row loses the compare-and-swap, re-reads and lands on top', async () => {
    const { row, actor } = await dataset();
    const winner = await mutateDataset(row, actor, 'insert into rows (n) values (2)');
    if (isMutationRefused(winner)) throw new Error(winner.detail);
    const late = await mutateDataset(row, actor, 'insert into rows (n) values (3)');
    if (isMutationRefused(late)) throw new Error(late.detail);
    expect(late).toMatchObject({ rowCount: 3, row: { version: row.version + 2 } });
  });

  it('the commit statement itself refuses a dataset made read-only after the caller read it', async () => {
    const { row, actor } = await dataset();
    await (await harness.db()).query("UPDATE artifacts SET access='read' WHERE id=$1", [row.id]);
    const refused = await mutateDataset(row, actor, 'insert into rows (n) values (2)');
    expect(isMutationRefused(refused) && refused.reason).toBe('dataset_read_only');
    expect((await getArtifactById(row.id))!.version).toBe(row.version);
  });
});

describe('a dataset policy write', () => {
  const policy = { version: 2, allow: [{ actions: ['read', 'insert'], from: { user: '$owner' } }] };
  it('bumps the revision, audits the actor, notifies, and refuses a stale revision or a stranger', async () => {
    const { row, actor, owner } = await dataset();
    const channel = await heard(row.id);
    expect(await setDatasetPolicy(actor, row.id, policy, 0)).toMatchObject({ revision: 1 });
    expect(await setDatasetPolicy(actor, row.id, policy, 0)).toEqual({ conflict: true });
    const stranger = await mintAccountToken('write_ownership_stranger');
    expect(await setDatasetPolicy(identityForUser(stranger.userId, stranger.id), row.id, policy, 1)).toBeNull();
    const audit = (await (await harness.db()).query('SELECT revision,actor_user_id,actor_token_id FROM dataset_policy_audit WHERE dataset_id=$1', [row.id])).rows;
    expect(audit).toEqual([{ revision: 1, actor_user_id: owner.userId, actor_token_id: owner.id }]);
    await (await harness.db()).query('SELECT 1');
    expect(channel.payloads).toEqual([row.edit_id]);
    await channel.stop();
    expect((await getArtifactById(row.id))!.policy_revision).toBe(1);
  });
});

describe('adoption on claim and on guest merge', () => {
  const page = (title: string) => ({ format: 'html' as const, source: nativeHtml(`<p>${title}</p>`), meta: {}, title });
  it('a claimed token brings its unowned, ungrouped artifacts and nothing else', async () => {
    const user = await createUser({ email: 'claimer@example.test' });
    const loose = await mintToken('loose', null);
    const mine = await createArtifact(loose.id, null, page('Mine'));
    const other = await createUser({ email: 'other@example.test' });
    const theirs = await createArtifact(loose.id, other.id, page('Theirs'));
    expect(await claimToken(user.id, loose.token)).toEqual({ tokenId: loose.id, claimedArtifacts: 1 });
    expect((await getArtifactById(mine.id))!.user_id).toBe(user.id);
    expect((await getArtifactById(theirs.id))!.user_id).toBe(other.id);
    // Re-claiming one's own token is harmless and finds nothing more.
    expect(await claimToken(user.id, loose.token)).toEqual({ tokenId: loose.id, claimedArtifacts: 0 });
  });

  it('a verified account merging a held guest takes its artifacts and tokens and marks the guest merged', async () => {
    const guest = await createGuestOwner();
    const made = await createArtifact(guest.tokenId, guest.userId, page('Guest draft'));
    const account = await createUser({ email: 'merger@example.test' });
    await mergeGuestUsers(account.id, [guest.tokenId]);
    expect((await getArtifactById(made.id))!.user_id).toBe(account.id);
    const db = await harness.db();
    expect((await db.query('SELECT user_id FROM tokens WHERE id=$1', [guest.tokenId])).rows).toEqual([{ user_id: account.id }]);
    expect((await db.query('SELECT merged_into_user_id FROM users WHERE id=$1', [guest.userId])).rows).toEqual([{ merged_into_user_id: account.id }]);
  });
});

describe('the inbox auto-accept setting', () => {
  it('an account turns it on and off; a guest cannot', async () => {
    const user = await createUser({ email: 'inbox@example.test' });
    const actor = identityForUser(user.id, null);
    expect((await membershipInbox(actor)).autoAccept).toBe(true);
    expect((await updateMembershipInbox(actor, { autoAccept: false })).autoAccept).toBe(false);
    expect((await updateMembershipInbox(actor, { autoAccept: true })).autoAccept).toBe(true);
    const guest = await createGuestOwner();
    await expect(updateMembershipInbox(identityForUser(guest.userId, guest.tokenId), { autoAccept: true })).rejects.toThrow('Sign in');
  });
});
