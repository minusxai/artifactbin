/**
 * Present-tense relationships: one subject/verb/object row with a lifecycle.
 * Active edges are accepted and not deleted. Events record their changes;
 * counts and access checks read the current relationship state.
 */
export type RelationStatus = 'pending' | 'accepted' | 'dismissed' | 'left';
export type RelationDirection = 'invitation' | 'request';
