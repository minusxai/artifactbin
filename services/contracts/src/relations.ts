/**
 * Present-tense relationships: one subject/verb/object row with a lifecycle.
 * Active edges are accepted and not deleted. Events record their changes;
 * counts and access checks read the current relationship state.
 */
import type { EventVerb } from './events';

export type RelationVerb = 'like' | 'follow' | 'join';
export type ImmediateRelationVerb = Exclude<RelationVerb, 'join'>;
export type RelationStatus = 'pending' | 'accepted' | 'dismissed' | 'left';
export type RelationDirection = 'invitation' | 'request';
export const RELATION_VERBS: readonly RelationVerb[] = ['like', 'follow', 'join'];

/** What each verb points at, and the two past tenses the log records for it. Closed: a verb outside this table is refused. */
export const RELATION_EVENTS: {
  readonly join: { readonly object: 'artifact'; readonly linked: EventVerb<'artifact'>; readonly unlinked: EventVerb<'artifact'> };
  readonly like: { readonly object: 'artifact'; readonly linked: EventVerb<'artifact'>; readonly unlinked: EventVerb<'artifact'> };
  readonly follow: { readonly object: 'user'; readonly linked: EventVerb<'user'>; readonly unlinked: EventVerb<'user'> };
} = {
  join: { object: 'artifact', linked: 'joined', unlinked: 'left' },
  like: { object: 'artifact', linked: 'liked', unlinked: 'unliked' },
  follow: { object: 'user', linked: 'followed', unlinked: 'unfollowed' },
};
