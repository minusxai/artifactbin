/**
 * THE PUBLIC EVENTS FEED (CONTRACT §6): `GET /api/events`, one authenticated feed for every event a caller may
 * observe, comments being one category of it. The rows are the events service's log (./events); this is the wire.
 *
 * - `position` is the installation feed position the events service assigned when it durably accepted the event,
 *   strictly increasing in commit order; `next` (or any event's `position`) resumes after it. Delivery is
 *   at-least-once: a consumer deduplicates by `id` and checkpoints only after handling a page.
 * - Access is re-checked on every poll: artifact events reach whoever may read the artifact's comments now, job
 *   events the direct members of the job's group. A filter on an artifact the caller cannot read is a 404.
 * - Payloads are ids and state, never content: comment text is read through the comment read
 *   (`GET /api/artifacts/ID/annotations`), which applies the comment permissions again.
 * - `actor.you`: the event was made with the credential reading the feed, and, when both name one, the same agent
 *   session (`Artifactbin-Session`), so a watcher skips its own writes and another agent on one sign-in is not you.
 */
import type { EventVerb, ObjectKind } from './events';

/** `object_kind.verb`, the one spelling of an event type on the wire. */
type TypeName<K extends ObjectKind> = { [V in EventVerb<K>]: `${K}.${V}` }[EventVerb<K>];

/** The categories a caller filters by, each an explicit list of types; a type outside the catalogue fails to compile. */
export const EVENT_CATEGORIES = {
  comments: [
    'artifact.annotated', 'artifact.annotation_replied', 'artifact.annotation_edited', 'artifact.annotation_resolved',
    'artifact.annotation_reopened', 'artifact.annotation_deleted', 'artifact.annotation_reaction_changed',
  ],
  jobs: ['job.run_started', 'job.run_succeeded', 'job.run_failed'],
} as const satisfies Record<string, readonly (TypeName<'artifact'> | TypeName<'job'>)[]>;

/** Every type the feed serves: each is recorded through a transactional outbox or a durable publish, never `emit`. */
export const EVENT_FEED_TYPES: readonly EventFeedType[] = Object.values(EVENT_CATEGORIES).flat();
export type EventFeedType = (typeof EVENT_CATEGORIES)[keyof typeof EVENT_CATEGORIES][number];

export const EVENT_FEED_SCHEMA_VERSION = 1;
/** `wait` holds a request until an event arrives, at most this long. */
export const EVENT_FEED_MAX_WAIT_SECONDS = 30;
/** The removed comment feed's wait, kept only until the production proxy (artifactbin-server) moves its long-poll
 * deadline to EVENT_FEED_MAX_WAIT_SECONDS: the pin moves on every merge here, so dropping it first breaks that build. */
export const COMMENT_CHANGES_MAX_WAIT_SECONDS = 60;
export const EVENT_FEED_DEFAULT_LIMIT = 100;
export const EVENT_FEED_MAX_LIMIT = 200;
/** A cursor whose next event was accepted longer ago than this is expired (410 `cursor_expired`): resynchronize. */
export const EVENT_FEED_RETENTION_DAYS = 30;

interface EventFeedActor { kind: 'user' | 'token' | 'service'; id: string; you: boolean }
export interface EventFeedEvent {
  /** Stable across redeliveries: the dedupe key. */
  id: string;
  position: number;
  type: EventFeedType;
  /** When the source recorded it (ISO-8601). Ordering and resumption use `position`, never this. */
  at: string;
  schema_version: typeof EVENT_FEED_SCHEMA_VERSION;
  resource: { kind: 'artifact' | 'job'; id: string };
  /** Null when nobody we can name did it. */
  actor: EventFeedActor | null;
  payload: Record<string, unknown>;
}
export interface EventFeedPage { events: EventFeedEvent[]; next: string }
// Every refusal is `{ error: { code, message? } }`: 400 invalid_*, 404 not_found, 410 cursor_expired,
// 429 too_many_event_waits (Retry-After: 1).
