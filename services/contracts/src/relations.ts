/**
 * RELATIONS — the sentences that are TRUE RIGHT NOW: a user likes an artifact,
 * a user follows a user. The same subject/verb/object shape as the events log,
 * in the present tense, at most one live row per pair, and undoable: the app
 * owns the table (`relations`, beside its entity tables), `deleted_at` is the
 * one generic reversal for every verb, and every change is also SAID to the
 * log in the past tense (liked/unliked, followed/unfollowed). A count is
 * COUNT(*) of live edges, never derived from the log.
 */
import type { EventVerb } from './events';

export type RelationVerb = 'like' | 'follow';
export const RELATION_VERBS: readonly RelationVerb[] = ['like', 'follow'];

/** What each verb points at, and the two past tenses the log records for it. Closed: a verb outside this table is refused. */
export const RELATION_EVENTS: {
  readonly like: { readonly object: 'artifact'; readonly linked: EventVerb<'artifact'>; readonly unlinked: EventVerb<'artifact'> };
  readonly follow: { readonly object: 'user'; readonly linked: EventVerb<'user'>; readonly unlinked: EventVerb<'user'> };
} = {
  like: { object: 'artifact', linked: 'liked', unlinked: 'unliked' },
  follow: { object: 'user', linked: 'followed', unlinked: 'unfollowed' },
};
