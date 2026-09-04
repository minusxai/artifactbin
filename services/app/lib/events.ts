/**
 * THE EMITTER — the one place the app turns a moment into a row of the log.
 * `emit` stamps the envelope (a uuid, the time, source 'app') and hands it to
 * `services().events`: the in-process writer, the HTTP client, or the noop,
 * decided once by the composition root. It NEVER rejects — it is called as
 * `void emit(...)` from request paths, and an unhandled rejection kills the
 * process — and, like trackEvent, it is never called from INSIDE a
 * `db.transaction` callback (PGLite serialises the op queue; fire after).
 *
 * The sentence is typed by the catalogue: a verb the object kind does not
 * take, or a payload of the wrong shape, is a compile error.
 */
import type { EventEnvelope, EventPayload, EventVerb, ObjectKind, SubjectKind } from '@artifactbin/contracts';

export interface EventSubject { kind: SubjectKind; id: string }
export interface EventObject<K extends ObjectKind = ObjectKind> { kind: K; id: string }

/** Build the row without sending it — pure, so a test can walk the whole catalogue. */
export function envelope<K extends ObjectKind, V extends EventVerb<K>>(
  subject: EventSubject | null,
  verb: V,
  object: EventObject<K>,
  payload: EventPayload<K, V>,
): EventEnvelope {
  void subject; void verb; void object; void payload;
  throw new Error('events-app: implement envelope');
}

/** Fire-and-forget: never rejects. Callers write `void emit(...)`; tests may await it. */
export async function emit<K extends ObjectKind, V extends EventVerb<K>>(
  subject: EventSubject | null,
  verb: V,
  object: EventObject<K>,
  payload: EventPayload<K, V>,
): Promise<void> {
  void subject; void verb; void object; void payload;
  throw new Error('events-app: implement emit');
}
