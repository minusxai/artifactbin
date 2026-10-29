/** Likes and follows: one live edge per pair, revived in place, each transition recorded once in the outbox. */
import { describe, expect, it } from 'vitest';
import type { ImmediateRelationVerb, RelationVerb } from '@artifactbin/contracts';
import { useAppHarness } from '@/__tests__/harness';
import { count, has, link, linked, replaceLinked, unlink } from '@/lib/social';
import { createUser } from '@/lib/accounts';
import { getDb } from '@/lib/platform';

useAppHarness();

/** The relation transitions written to the outbox, oldest first, as `verb object_id`. */
const said = async () => (await (await getDb()).query<{ line: string }>(
  "SELECT (envelope->>'verb') || ' ' || (envelope->>'object_id') AS line FROM event_outbox WHERE envelope->>'verb' IN ('liked','unliked','followed','unfollowed') ORDER BY created_at, id",
)).rows.map((r) => r.line);
const edge = async (userId: string, objectId: string) => (await (await getDb()).query<{ revision: number; created_at: string; status: string }>(
  'SELECT revision, created_at, status FROM relations WHERE subject_id = $1 AND object_id = $2', [userId, objectId])).rows;

describe('link and unlink', () => {
  it('a like is linked once and says liked once; a second link is already and silent', async () => {
    const user = await createUser({ email: 'fan@example.test' });
    expect(await link(user.id, 'like', 'art_1')).toBe('linked');
    expect(await link(user.id, 'like', 'art_1')).toBe('already');
    expect(await has(user.id, 'like', 'art_1')).toBe(true);
    expect(await count('like', 'art_1')).toBe(1);
    expect(await linked(user.id, 'like')).toEqual(['art_1']);
    expect(await said()).toEqual(['liked art_1']);
  });

  it('unlink ends the edge once; a re-link revives the same row with a new revision', async () => {
    const user = await createUser({ email: 'fan@example.test' });
    await link(user.id, 'like', 'art_1');
    const [born] = await edge(user.id, 'art_1');
    expect(await unlink(user.id, 'like', 'art_1')).toBe('unlinked');
    expect(await unlink(user.id, 'like', 'art_1')).toBe('absent');
    expect(await unlink(user.id, 'like', 'art_never')).toBe('absent');
    expect(await has(user.id, 'like', 'art_1')).toBe(false);
    expect(await count('like', 'art_1')).toBe(0);
    expect(await linked(user.id, 'like')).toEqual([]);
    expect(await link(user.id, 'like', 'art_1')).toBe('linked');
    const revived = await edge(user.id, 'art_1');
    expect(revived).toHaveLength(1);
    expect(revived[0]).toMatchObject({ created_at: born!.created_at, status: 'accepted', revision: born!.revision + 2 });
    expect(await said()).toEqual(['liked art_1', 'unliked art_1', 'liked art_1']);
  });

  it('counts live edges into an object across users; a follow points at a user and is a separate vocabulary', async () => {
    const a = await createUser({ email: 'a@example.test' }), b = await createUser({ email: 'b@example.test' });
    await link(a.id, 'like', 'art_1');
    await link(b.id, 'like', 'art_1');
    await link(a.id, 'follow', b.id);
    expect(await count('like', 'art_1')).toBe(2);
    expect(await count('follow', b.id)).toBe(1);
    expect(await count('like', b.id)).toBe(0);
    expect(await has(a.id, 'like', b.id)).toBe(false);
    expect(await linked(a.id, 'follow')).toEqual([b.id]);
    await unlink(b.id, 'like', 'art_1');
    expect(await count('like', 'art_1')).toBe(1);
    expect(await said()).toEqual(['liked art_1', 'liked art_1', `followed ${b.id}`, 'unliked art_1']);
  });

  it('refuses join (membership owns it) and any verb outside the vocabulary, before writing', async () => {
    const user = await createUser({ email: 'fan@example.test' });
    const join = 'join' as unknown as ImmediateRelationVerb;
    await expect(link(user.id, join, 'art_1')).rejects.toThrow('membership');
    await expect(unlink(user.id, join, 'art_1')).rejects.toThrow('membership');
    const db = await getDb();
    await expect(db.transaction((tx) => replaceLinked(tx, user.id, join, ['art_1']))).rejects.toThrow('membership');
    const bogus = "like' OR '1'='1" as unknown as RelationVerb;
    await expect(has(user.id, bogus, 'art_1')).rejects.toThrow('unknown relation verb');
    await expect(count(bogus, 'art_1')).rejects.toThrow('unknown relation verb');
    await expect(linked(user.id, bogus)).rejects.toThrow('unknown relation verb');
    await expect(link(user.id, bogus as ImmediateRelationVerb, 'art_1')).rejects.toThrow('unknown relation verb');
    expect((await db.query('SELECT 1 FROM relations')).rows).toHaveLength(0);
  });
});

describe('replaceLinked', () => {
  it('replaces the live set in the caller\'s transaction, saying only what changed', async () => {
    const user = await createUser({ email: 'fan@example.test' });
    await link(user.id, 'like', 'art_a');
    await link(user.id, 'like', 'art_b');
    await link(user.id, 'like', 'art_old');
    await unlink(user.id, 'like', 'art_old');
    const before = (await said()).length;
    const db = await getDb();
    await db.transaction((tx) => replaceLinked(tx, user.id, 'like', ['art_b', 'art_c', 'art_old']));
    expect((await linked(user.id, 'like')).sort()).toEqual(['art_b', 'art_c', 'art_old']);
    expect((await said()).slice(before).sort()).toEqual(['liked art_c', 'liked art_old', 'unliked art_a']);
    await db.transaction((tx) => replaceLinked(tx, user.id, 'like', []));
    expect(await linked(user.id, 'like')).toEqual([]);
    expect(await count('like', 'art_b')).toBe(0);
  });

  it('takes distinct ids only: a repeated id aborts the replacement and changes nothing', async () => {
    // Its one caller passes ids parseAccountResource has already proven distinct.
    const user = await createUser({ email: 'fan@example.test' });
    await link(user.id, 'like', 'art_a');
    const db = await getDb();
    await expect(db.transaction((tx) => replaceLinked(tx, user.id, 'like', ['art_c', 'art_c']))).rejects.toThrow('cannot affect row a second time');
    expect(await linked(user.id, 'like')).toEqual(['art_a']);
  });

  it('rolls back with the caller\'s transaction', async () => {
    const user = await createUser({ email: 'fan@example.test' });
    await link(user.id, 'follow', 'usr_a');
    const db = await getDb();
    await expect(db.transaction(async (tx) => { await replaceLinked(tx, user.id, 'follow', ['usr_b']); throw new Error('abort'); })).rejects.toThrow('abort');
    expect(await linked(user.id, 'follow')).toEqual(['usr_a']);
    expect(await said()).toEqual(['followed usr_a']);
  });
});
