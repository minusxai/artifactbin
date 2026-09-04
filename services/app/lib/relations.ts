/**
 * RELATIONS — the sentences that are true right now, and the ONLY module that
 * touches the `relations` table. `link` inserts the edge (or revives an undone
 * one, clearing `deleted_at` on the same row) and says `liked`/`followed` to
 * the log; `unlink` sets `deleted_at` and says `unliked`/`unfollowed`. Nothing
 * per-verb leaks out: the object kind and both past tenses come from the
 * contract's RELATION_EVENTS, every read carries the `verb = '…'` literal the
 * partial indexes need, and a verb outside the vocabulary is refused. A count
 * is COUNT(*) of live edges — never derived from the log. An event is said
 * only when the state CHANGED: linking twice is one row and one sentence.
 *
 * Never inside a `db.transaction` callback (the emit would deadlock PGLite).
 */
import type { RelationVerb } from '@artifactbin/contracts';

/** What the subject of every relation is today: an account. */
export const RELATION_SUBJECT_KIND = 'user' as const;

/** Insert the edge, or revive it. `already` = it was live and nothing changed (no event). */
export async function link(userId: string, verb: RelationVerb, objectId: string): Promise<'linked' | 'already'> {
  void userId; void verb; void objectId;
  throw new Error('events-relations: implement link');
}

/** Set `deleted_at` on the live edge. `absent` = there was none (no event). */
export async function unlink(userId: string, verb: RelationVerb, objectId: string): Promise<'unlinked' | 'absent'> {
  void userId; void verb; void objectId;
  throw new Error('events-relations: implement unlink');
}

/** Is the edge live? */
export async function has(userId: string, verb: RelationVerb, objectId: string): Promise<boolean> {
  void userId; void verb; void objectId;
  throw new Error('events-relations: implement has');
}

/** Live edges INTO an object: likes on an artifact, followers of a user. */
export async function count(verb: RelationVerb, objectId: string): Promise<number> {
  void verb; void objectId;
  throw new Error('events-relations: implement count');
}

/** Live edges OUT of a user for a verb: the artifacts they like, the users they follow — the audience of a feed. */
export async function linked(userId: string, verb: RelationVerb): Promise<string[]> {
  void userId; void verb;
  throw new Error('events-relations: implement linked');
}
