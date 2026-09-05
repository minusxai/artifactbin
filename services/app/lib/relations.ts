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
import { RELATION_EVENTS, RELATION_VERBS, type RelationVerb } from '@artifactbin/contracts';
import { getDb } from '@/lib/db';
import { emit } from '@/lib/events';

/** What the subject of every relation is today: an account. */
export const RELATION_SUBJECT_KIND = 'user' as const;

/** One catalogue entry: the object kind this verb points at, and its two past tenses. */
type RelationEvent = (typeof RELATION_EVENTS)[RelationVerb];
/** The past tense a state change is said in — the two keys every catalogue entry carries. */
type Direction = 'linked' | 'unlinked';

/**
 * THE ONE GATE. Every exported function goes through it before a single
 * character of SQL is built, which is what makes the interpolated verb literal
 * below safe BY CONSTRUCTION rather than by convention: nothing reaches the
 * string builder that is not one of the words in `RELATION_VERBS`.
 *
 * It also hands back the catalogue entry, so the object kind and the two past
 * tenses arrive from the same lookup that admitted the verb.
 */
function vocabulary(verb: RelationVerb): RelationEvent {
  if (!RELATION_VERBS.includes(verb)) throw new Error(`unknown relation verb: ${String(verb)}`);
  return RELATION_EVENTS[verb];
}

/**
 * The pair, as the primary key spells it.
 *
 * The verb and the kinds are INLINED (never parameters) because the partial
 * indexes carry the verb literal in their predicates, and Postgres can only
 * match a partial index when the predicate is provable at plan time — a `$n`
 * placeholder turns every one of these into a sequential scan. `vocabulary()`
 * above is what makes the interpolation safe; the ids stay parameters.
 */
const subjectWhere = (verb: RelationVerb, entry: RelationEvent) =>
  `subject_kind = '${RELATION_SUBJECT_KIND}' AND subject_id = $1 AND verb = '${verb}' AND object_kind = '${entry.object}'`;

/**
 * Say the change to the log, in the object's own vocabulary.
 *
 * The two arms narrow on the OBJECT KIND, not on the verb: the past tenses and
 * the kind both still come from the catalogue entry, and no verb string is
 * written here. It is spelled this way because `emit` is generic in the object
 * kind, and a UNION of kinds collapses `keyof EventVerbs[K]` to `never` — one
 * call with a union entry does not type-check. Do not fold it back into one.
 *
 * AWAITED, unlike the fire-and-forget `void emit(...)` of the request paths:
 * this is a state CHANGE being recorded rather than a passing observation, and
 * `emit` never rejects, so awaiting costs a microtask and buys a caller that is
 * told the state moved only after the sentence was handed to the log.
 */
async function say(entry: RelationEvent, direction: Direction, userId: string, objectId: string): Promise<void> {
  const subject = { kind: RELATION_SUBJECT_KIND, id: userId };
  if (entry.object === 'artifact') await emit(subject, entry[direction], { kind: entry.object, id: objectId }, {});
  else await emit(subject, entry[direction], { kind: entry.object, id: objectId }, {});
}

/** Insert the edge, or revive it. `already` = it was live and nothing changed (no event). */
export async function link(userId: string, verb: RelationVerb, objectId: string): Promise<'linked' | 'already'> {
  const entry = vocabulary(verb);
  const db = await getDb();
  /*
   * ONE statement, so an insert and a revival race no one: the conflict target
   * IS the pair, and the `WHERE` on the update arm is what tells the two
   * outcomes apart — an already-live row updates nothing and returns nothing,
   * which is exactly `already`. `created_at` is left alone on a revival: it
   * records when this row came into being, and every link and unlink since is
   * already in the log.
   */
  const changed = await db.query(
    `INSERT INTO relations (subject_kind, subject_id, verb, object_kind, object_id)
     VALUES ('${RELATION_SUBJECT_KIND}', $1, '${verb}', '${entry.object}', $2)
     ON CONFLICT (subject_kind, subject_id, verb, object_kind, object_id)
     DO UPDATE SET deleted_at = NULL WHERE relations.deleted_at IS NOT NULL
     RETURNING 1`,
    [userId, objectId],
  );
  if (changed.rows.length === 0) return 'already';
  await say(entry, 'linked', userId, objectId);
  return 'linked';
}

/** Set `deleted_at` on the live edge. `absent` = there was none (no event). */
export async function unlink(userId: string, verb: RelationVerb, objectId: string): Promise<'unlinked' | 'absent'> {
  const entry = vocabulary(verb);
  const db = await getDb();
  const changed = await db.query(
    `UPDATE relations SET deleted_at = now() WHERE ${subjectWhere(verb, entry)} AND object_id = $2 AND deleted_at IS NULL RETURNING 1`,
    [userId, objectId],
  );
  if (changed.rows.length === 0) return 'absent';
  await say(entry, 'unlinked', userId, objectId);
  return 'unlinked';
}

/** Is the edge live? */
export async function has(userId: string, verb: RelationVerb, objectId: string): Promise<boolean> {
  const entry = vocabulary(verb);
  const db = await getDb();
  const live = await db.query(
    `SELECT 1 FROM relations WHERE ${subjectWhere(verb, entry)} AND object_id = $2 AND deleted_at IS NULL`,
    [userId, objectId],
  );
  return live.rows.length > 0;
}

/** Live edges INTO an object: likes on an artifact, followers of a user. */
export async function count(verb: RelationVerb, objectId: string): Promise<number> {
  const entry = vocabulary(verb);
  const db = await getDb();
  const total = await db.query<{ n: string | number }>(
    `SELECT COUNT(*) AS n FROM relations WHERE verb = '${verb}' AND object_kind = '${entry.object}' AND object_id = $1 AND deleted_at IS NULL`,
    [objectId],
  );
  // COUNT() comes back as a bigint, which both drivers hand over as a string.
  return Number(total.rows[0]?.n ?? 0);
}

/** Live edges OUT of a user for a verb: the artifacts they like, the users they follow — the audience of a feed. */
export async function linked(userId: string, verb: RelationVerb): Promise<string[]> {
  const entry = vocabulary(verb);
  const db = await getDb();
  const out = await db.query<{ object_id: string }>(
    // Newest first, then by id: two edges made in the same millisecond still
    // come back in ONE order, so a feed built on this never shuffles.
    `SELECT object_id FROM relations WHERE ${subjectWhere(verb, entry)} AND deleted_at IS NULL ORDER BY created_at DESC, object_id`,
    [userId],
  );
  return out.rows.map((row) => row.object_id);
}
