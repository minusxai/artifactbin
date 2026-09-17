/**
 * lib/relations.ts: one live row per pair, ever; a reversal is `deleted_at`;
 * a revival clears it on the SAME row; a change is said to the log in the past
 * tense and a non-change says nothing; counts are live edges; the vocabulary
 * is closed.
 *
 * Seeded RED by the orchestrator.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeEvents, type FakeEvents } from '@artifactbin/utils';
import { useAppHarness } from '@/__tests__/harness';
import { count, has, link, linked, unlink } from '@/lib/relations';
import { setServices } from '@/lib/services';

const harness = useAppHarness();
let fake: FakeEvents;
beforeEach(() => { fake = fakeEvents(); setServices({ events: fake }); });

const rows = async (verb: string) => (await (await harness.db()).query<{ subject_id: string; object_id: string; deleted_at: string | null }>('SELECT subject_id, object_id, deleted_at FROM relations WHERE verb = $1 ORDER BY subject_id, object_id', [verb])).rows;

describe('like', () => {
  it('link inserts one live edge and says artifact.liked once; linking again changes nothing and says nothing', async () => {
    expect(await link('usr_a', 'like', 'art001')).toBe('linked');
    expect(await link('usr_a', 'like', 'art001')).toBe('already');
    expect(await rows('like')).toEqual([{ subject_id: 'usr_a', object_id: 'art001', deleted_at: null }]);
    expect(await has('usr_a', 'like', 'art001')).toBe(true);
    expect(await count('like', 'art001')).toBe(1);
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0]).toMatchObject({ verb: 'liked', subject_kind: 'user', subject_id: 'usr_a', object_kind: 'artifact', object_id: 'art001', source: 'app' });
  });
  it('unlink sets deleted_at on the same row and says unliked; unlinking again is absent and silent; a re-link revives the SAME row', async () => {
    await link('usr_a', 'like', 'art001');
    expect(await unlink('usr_a', 'like', 'art001')).toBe('unlinked');
    expect(await unlink('usr_a', 'like', 'art001')).toBe('absent');
    const undone = await rows('like');
    expect(undone).toHaveLength(1);
    expect(undone[0]!.deleted_at).not.toBeNull();
    expect(await has('usr_a', 'like', 'art001')).toBe(false);
    expect(await count('like', 'art001')).toBe(0);
    expect(await link('usr_a', 'like', 'art001')).toBe('linked');
    const revived = await rows('like');
    expect(revived).toEqual([{ subject_id: 'usr_a', object_id: 'art001', deleted_at: null }]);
    expect(fake.events.map((e) => e.verb)).toEqual(['liked', 'unliked', 'liked']);
  });
  it('count is the live edges into the artifact; linked is the live edges out of the user', async () => {
    await link('usr_a', 'like', 'art001');
    await link('usr_b', 'like', 'art001');
    await link('usr_a', 'like', 'art002');
    await unlink('usr_b', 'like', 'art001');
    expect(await count('like', 'art001')).toBe(1);
    expect(await count('like', 'art002')).toBe(1);
    expect((await linked('usr_a', 'like')).sort()).toEqual(['art001', 'art002']);
    expect(await linked('usr_b', 'like')).toEqual([]);
  });
});

describe('follow', () => {
  it('the same module, the other vocabulary: user → user, user.followed / user.unfollowed', async () => {
    expect(await link('usr_a', 'follow', 'usr_b')).toBe('linked');
    expect(await link('usr_a', 'follow', 'usr_c')).toBe('linked');
    expect(await unlink('usr_a', 'follow', 'usr_c')).toBe('unlinked');
    expect((await linked('usr_a', 'follow'))).toEqual(['usr_b']);
    expect(await count('follow', 'usr_b')).toBe(1);
    expect(fake.events.map((e) => [e.verb, e.object_kind, e.object_id])).toEqual([['followed', 'user', 'usr_b'], ['followed', 'user', 'usr_c'], ['unfollowed', 'user', 'usr_c']]);
  });
  it('a verb outside the vocabulary is refused before any query', async () => {
    await expect(link('usr_a', 'admire' as never, 'usr_b')).rejects.toThrow(/verb/);
    expect(await rows('admire')).toEqual([]);
    expect(fake.events).toHaveLength(0);
  });
  it('a failing log never fails the relation', async () => {
    fake.fail = new Error('log down');
    expect(await link('usr_a', 'follow', 'usr_b')).toBe('linked');
    expect(await has('usr_a', 'follow', 'usr_b')).toBe(true);
  });
});
