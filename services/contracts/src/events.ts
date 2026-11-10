/**
 * THE EVENTS SERVICE — the log of what happened, owned by ONE service in a
 * schema of its own; everyone else emits to it and reads it with SELECT.
 *
 * One row shape, shared with the app's relations table: a SENTENCE —
 * subject_kind/subject_id, verb, object_kind/object_id — plus what history
 * needs (id, at, source, payload). The object is always the thing whose owner
 * cares: a fork's object is the ORIGINAL and the new id rides in the payload,
 * a comment's object is the ARTIFACT and the annotation id rides in the
 * payload, so "what happened to what I own" is one predicate on object_id.
 * A name, where one is needed (a forwarding rule, a test), is
 * `object_kind.verb` — derived, never stored.
 *
 * Observational events use best-effort `emit`; notification-producing changes
 * use transactional outbox publication, and so does every type the public feed
 * serves (./event-feed). Payloads carry ids and state, never content or secrets.
 */
import type { CommentReactionKind } from './annotation-comment';

/** `service`: another product speaking for itself (MinusX's job runs), never a person or a credential. */
export type SubjectKind = 'user' | 'token' | 'visitor' | 'service';
/** `job`: a MinusX schedule's run, published by MinusX (CONTRACT §6); observable by direct members of its group. */
export type ObjectKind = 'group' | 'artifact' | 'user' | 'token' | 'door' | 'route' | 'job';
export type EventSource = 'app' | 'auth' | 'proxy' | 'minusx';

/** Nothing to say beyond the sentence itself. */
type EmptyPayload = Record<string, never>;
/** Who touched an artifact, as far as telemetry may know it: the client guess (lib/accounts/client-identity) and the account when signed in. */
interface ArtifactActorPayload { client?: string | null; user_id?: string | null }
/** A create also says WHERE, so a folder create and a filed create read as themselves in the log. Null/absent = the root. */
interface ArtifactCreatedPayload extends ArtifactActorPayload { parent_id?: string | null }
/**
 * The credential and agent session (`Artifactbin-Session`) a comment change was made with. Stored so the public
 * feed can mark a reader's own writes `you` per credential and session; the feed never serves it.
 */
export interface EventOrigin { token_id: string | null; session: string | null }
/** `annotation_id` is always the thread (its root comment); `reply_id` names the reply when the change was one. */
interface AnnotationPayload { annotation_id: string; reply_id?: string; agent?: boolean; resolved?: boolean; via?: EventOrigin }
/** A reaction added or taken back: `count` is that kind's count on the comment right after the change. */
interface AnnotationReactionPayload extends AnnotationPayload { kind: CommentReactionKind; active: boolean; count: number }
/** Ids only: the schedule, this run of it, and the group whose direct members may observe it. */
interface JobRunPayload { schedule_id: string; occurrence_id: string; group_id: string }
interface MembershipEventPayload { user_id: string; revision: number; mention_ref?: string | null }
/** Where a row went. Either end may be the ROOT, which is null — a folder is an artifact, so both are artifact ids. */
interface MovedPayload { from_parent_id: string | null; to_parent_id: string | null }
/** A delete also says what went with it: the row's own format, and the descendants that followed (0 for a document). */
interface ArtifactDeletedPayload extends ArtifactActorPayload { format?: string; subtree?: number }
/** Whether the row came back where it was, or at the root because an ancestor was not there to hold it. */
interface RestoredPayload { landed_at_root: boolean }
interface TokenPayload { name?: string | null }

/**
 * THE CATALOGUE — every verb an object kind takes, with the payload it
 * carries. A wrong verb or a wrong payload is a compile error; `EVENT_VERBS`
 * below is the same list at runtime, so a test can walk every one.
 */
interface EventVerbs {
  group:{changed:{action:string;audit_id:string;recipients:string[];invitation_id?:string}};
  artifact: {
    created: ArtifactCreatedPayload;
    updated: ArtifactActorPayload;
    edited: ArtifactActorPayload;
    reverted: ArtifactActorPayload;
    /**
     * DELETED — and that is the whole of it. Nothing in this product erases a
     * row, so there is no second verb for "gone for good": the row is kept, the
     * link stops working, and `restored` is the reverse. A folder takes its
     * subtree, and `subtree` says how much went.
     */
    deleted: ArtifactDeletedPayload;
    /** Placement changed: the PATCH door, and a replace that files the row. A folder's subtree follows it silently. */
    moved: MovedPayload;
    /** Back out of the trash. */
    restored: RestoredPayload;
    exported: ArtifactActorPayload;
    mutated: ArtifactActorPayload;
    /** The subject is ALWAYS the daily visitor hash, signed in or not — the view counts dedupe on it. */
    viewed: ArtifactActorPayload;
    /** Recorded against the ORIGINAL; the copy is `fork_id`. */
    forked: ArtifactActorPayload & { fork_id?: string | null };
    /** A new thread. A reply is `annotation_replied`; a reply that also resolved the thread carries `resolved: true`. */
    annotated: AnnotationPayload;
    annotation_replied: AnnotationPayload;
    /** Someone's reaction on a comment changed (added or taken back): one event per effective change. */
    annotation_reaction_changed: AnnotationReactionPayload;
    annotation_resolved: AnnotationPayload;
    annotation_deleted: AnnotationPayload;
    sharing_changed: { visibility?: string | null; link_role?: string | null };
    join_requested: MembershipEventPayload;
    invited: MembershipEventPayload;
    mentioned: MembershipEventPayload;
    invitation_dismissed: MembershipEventPayload;
    annotation_reopened: AnnotationPayload;
    /** A comment's author rewrote its text; `reply_id` names the reply when it was not the thread's first comment. */
    annotation_edited: AnnotationPayload;
    joined: MembershipEventPayload;
    left: MembershipEventPayload;
    liked: EmptyPayload;
    unliked: EmptyPayload;
  };
  user: {
    notification_changed: {notification_id:string;revision:number;change:"updated"|"read"|"removed"};
    /** The one place an email may travel: identity events, where the id alone says nothing to an operator. */
    /** A user row came into being — the first verified login. Fires once per account, before that login's `login_verified`. */
    signed_up: { email: string };
    login_sent: { email: string };
    login_verified: { email: string };
    oauth_linked: { provider: string };
    followed: EmptyPayload;
    unfollowed: EmptyPayload;
  };
  token: {
    minted: TokenPayload;
    claimed: TokenPayload;
    revoked: TokenPayload;
  };
  door: {
    denied: { door: string };
  };
  route: {
    failed: { status: number; method?: string };
  };
  job: {
    run_started: JobRunPayload;
    run_succeeded: JobRunPayload;
    run_failed: JobRunPayload;
  };
}

export type EventVerb<K extends ObjectKind = ObjectKind> = keyof EventVerbs[K] & string;
export type EventPayload<K extends ObjectKind, V extends EventVerb<K>> = EventVerbs[K][V];

/** The catalogue at runtime. Complete by construction: a verb missing from a list fails to type-check. */
export const EVENT_VERBS = {
  group:['changed'],
  artifact: ['created', 'updated', 'edited', 'reverted', 'deleted', 'moved', 'restored', 'exported', 'mutated', 'viewed', 'forked', 'annotated', 'annotation_resolved', 'annotation_deleted', 'sharing_changed', 'liked', 'unliked', 'joined', 'left', 'join_requested', 'invited', 'mentioned', 'invitation_dismissed', 'annotation_reopened', 'annotation_edited', 'annotation_replied', 'annotation_reaction_changed'],
  user: ['notification_changed', 'signed_up', 'login_sent', 'login_verified', 'oauth_linked', 'followed', 'unfollowed'],
  token: ['minted', 'claimed', 'revoked'],
  door: ['denied'],
  route: ['failed'],
  job: ['run_started', 'run_succeeded', 'run_failed'],
} as const satisfies { readonly [K in ObjectKind]: readonly EventVerb<K>[] };
// Every verb of every kind is listed above: a missing one fails the type check here.
(null as unknown as {
  [K in ObjectKind]: Exclude<EventVerb<K>, (typeof EVENT_VERBS)[K][number]> extends never ? true : false
}[ObjectKind]) satisfies true;

/** One row of the log — the sentence plus what history needs. Flat, because it IS the row and the wire. */
export interface EventEnvelope {
  /** Emitter-minted uuid: the receiver inserts `ON CONFLICT (id) DO NOTHING`, so a retried batch is harmless. */
  id: string;
  /** ISO-8601, stamped by the emitter. */
  at: string;
  source: EventSource;
  subject_kind: SubjectKind | null;
  subject_id: string | null;
  verb: string;
  object_kind: ObjectKind;
  object_id: string;
  payload: Record<string, unknown>;
}

/** `object_kind.verb` — the derived name a forwarding rule or a test matches on. */
export const eventName = (e: Pick<EventEnvelope, 'object_kind' | 'verb'>): string => `${e.object_kind}.${e.verb}`;

/** What an emitter holds. `emit` NEVER rejects; `close` flushes whatever is queued (a batching client) and is optional. */
export interface EventsService {
  emit(events: EventEnvelope[]): Promise<void>;
  /** Durable acceptance: rejects until storage commits. Source outboxes retry stable IDs. */
  publish?(events: EventEnvelope[]): Promise<void>;
  close?(): Promise<void>;
}

/**
 * A DURABLE subscriber: every stored event gets a delivery row per subscriber in the same statement that stores it,
 * and the service's boot drains them every second, one event at a time, retrying a failed delivery with exponential
 * backoff (at most an hour). Empty in the OSS composition; a deployment fills the list. IDs must be unique.
 */
export interface EventSubscriber { id: string; deliver: EventSink }

/** A LEGACY sink: handed each stored batch once, best effort; a sink that throws is logged and never fails the write. */
export type EventSink = (events: EventEnvelope[]) => Promise<void>;

/** The wire: `emit` (best effort, never rejects) and `publish` (durable, rejects until stored). `serveEvents`/`eventsClient` implement exactly this. */
export const EVENTS_ROUTES = { emit: '/emit', publish: '/publish' } as const;

/**
 * MinusX's job events (CONTRACT §6) on the APP's origin: the durable `publish`, service-authenticated
 * (SERVICE_AUTH_HEADER carrying INTERNAL__SERVICE_SECRET) and narrowed to `source: 'minusx'`, `object_kind: 'job'`.
 * The auth host serves it in front of its internal boundary, onto whatever events service the process holds, so a
 * one-process installation (events in process, no `/publish` socket) still has a door MinusX's sink can reach;
 * a split deployment may point MinusX at the events service's own `EVENTS_ROUTES.publish` instead.
 */
export const EVENTS_PUBLISH_PATH = '/api/internal/events/publish';
/** At most this many envelopes per publish (MinusX drains its outbox in batches of at most 100). */
export const EVENTS_PUBLISH_MAX_BATCH = 500;
