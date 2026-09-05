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
 * Telemetry only: nothing in the product gates on the log, `emit` never
 * throws, and a payload carries ids and names, never content or secrets.
 */
export type SubjectKind = 'user' | 'token' | 'visitor';
export type ObjectKind = 'artifact' | 'user' | 'token' | 'door' | 'route';
export type EventSource = 'app' | 'proxy';

/** Nothing to say beyond the sentence itself. */
export type EmptyPayload = Record<string, never>;
/** Who touched an artifact, as far as telemetry may know it: the client guess (lib/client-identity) and the account when signed in. */
export interface ArtifactActorPayload { client?: string | null; user_id?: string | null }
/** A create also says WHERE, so a folder create and a filed create read as themselves in the log. Null/absent = the root. */
export interface ArtifactCreatedPayload extends ArtifactActorPayload { parent_id?: string | null }
export interface AnnotationPayload { annotation_id: string }
/** Where a row went. Either end may be the ROOT, which is null — a folder is an artifact, so both are artifact ids. */
export interface MovedPayload { from_parent_id: string | null; to_parent_id: string | null }
/** A delete also says what went with it: the row's own format, and the descendants that followed (0 for a document). */
export interface ArtifactDeletedPayload extends ArtifactActorPayload { format?: string; subtree?: number }
/** Whether the row came back where it was, or at the root because an ancestor was not there to hold it. */
export interface RestoredPayload { landed_at_root: boolean }
export interface TokenPayload { name?: string | null }

/**
 * THE CATALOGUE — every verb an object kind takes, with the payload it
 * carries. A wrong verb or a wrong payload is a compile error; `EVENT_VERBS`
 * below is the same list at runtime, so a test can walk every one.
 */
export interface EventVerbs {
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
    annotated: AnnotationPayload;
    annotation_resolved: AnnotationPayload;
    annotation_deleted: AnnotationPayload;
    sharing_changed: { visibility?: string | null; link_role?: string | null };
    liked: EmptyPayload;
    unliked: EmptyPayload;
  };
  user: {
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
}

export type EventVerb<K extends ObjectKind = ObjectKind> = keyof EventVerbs[K] & string;
export type EventPayload<K extends ObjectKind, V extends EventVerb<K>> = EventVerbs[K][V];

/** The catalogue at runtime. Complete by construction: a verb missing from a list fails to type-check. */
type Complete<K extends ObjectKind, T extends readonly EventVerb<K>[]> =
  Exclude<EventVerb<K>, T[number]> extends never ? T : { 'missing verb': Exclude<EventVerb<K>, T[number]> };
const complete = <K extends ObjectKind>() => <const T extends readonly EventVerb<K>[]>(verbs: Complete<K, T>): readonly EventVerb<K>[] => verbs as T;

export const EVENT_VERBS: { readonly [K in ObjectKind]: readonly EventVerb<K>[] } = {
  artifact: complete<'artifact'>()(['created', 'updated', 'edited', 'reverted', 'deleted', 'moved', 'restored', 'exported', 'mutated', 'viewed', 'forked', 'annotated', 'annotation_resolved', 'annotation_deleted', 'sharing_changed', 'liked', 'unliked']),
  user: complete<'user'>()(['signed_up', 'login_sent', 'login_verified', 'oauth_linked', 'followed', 'unfollowed']),
  token: complete<'token'>()(['minted', 'claimed', 'revoked']),
  door: complete<'door'>()(['denied']),
  route: complete<'route'>()(['failed']),
};

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
  close?(): Promise<void>;
}

/** Where the service hands a stored batch next — empty in the OSS composition; a deployment fills the list. Never throws into the writer. */
export type EventSink = (events: EventEnvelope[]) => Promise<void>;

/** The wire: one POST. `serveEvents`/`eventsClient` implement exactly this. */
export const EVENTS_ROUTES = { emit: '/emit' } as const;
