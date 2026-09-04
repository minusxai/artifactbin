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
import { randomUUID } from 'node:crypto';
import type { EventEnvelope, EventPayload, EventVerb, ObjectKind, SubjectKind } from '@artifactbin/contracts';
import { services } from '@/lib/services';

export interface EventSubject { kind: SubjectKind; id: string }
export interface EventObject<K extends ObjectKind = ObjectKind> { kind: K; id: string }

/** Build the row without sending it — pure, so a test can walk the whole catalogue. */
export function envelope<K extends ObjectKind, V extends EventVerb<K>>(
  subject: EventSubject | null,
  verb: V,
  object: EventObject<K>,
  payload: EventPayload<K, V>,
): EventEnvelope {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    source: 'app',
    // Two nulls, never a missing column: the row has both, and "nobody did it"
    // is a state the log records rather than one it omits.
    subject_kind: subject?.kind ?? null,
    subject_id: subject?.id ?? null,
    verb,
    object_kind: object.kind,
    object_id: object.id,
    // Spread so the envelope owns its own object — a caller mutating what it
    // passed cannot rewrite a queued row. The assertion is only about the
    // index signature: an INTERFACE (which every catalogue payload is) never
    // gets the implicit one a `Record<string, unknown>` column wants.
    payload: { ...payload } as Record<string, unknown>,
  };
}

/** Fire-and-forget: never rejects. Callers write `void emit(...)`; tests may await it. */
export async function emit<K extends ObjectKind, V extends EventVerb<K>>(
  subject: EventSubject | null,
  verb: V,
  object: EventObject<K>,
  payload: EventPayload<K, V>,
): Promise<void> {
  try {
    await services().events.emit([envelope(subject, verb, object, payload)]);
  } catch (error) {
    // Telemetry never takes a request down with it, and an unhandled rejection
    // out of a `void emit(...)` would kill the process.
    console.error('[events] emit failed:', error);
  }
}
