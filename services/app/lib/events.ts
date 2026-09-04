/**
 * THE EMITTER — the one place the app turns a moment into a row of the log.
 * `emit` stamps the envelope (utils' one builder: a uuid, the time, source 'app') and hands it to
 * `services().events`: the in-process writer, the HTTP client, or the noop,
 * decided once by the composition root. It NEVER rejects — it is called as
 * `void emit(...)` from request paths, and an unhandled rejection kills the
 * process — and, like trackEvent, it is never called from INSIDE a
 * `db.transaction` callback (PGLite serialises the op queue; fire after).
 *
 * The sentence is typed by the catalogue: a verb the object kind does not
 * take, or a payload of the wrong shape, is a compile error.
 */
import type { EventEnvelope, EventPayload, EventVerb, ObjectKind } from '@artifactbin/contracts';
import { envelope as build, type EventObject, type EventSubject } from '@artifactbin/utils';
import { services } from '@/lib/services';

export type { EventObject, EventSubject };

/**
 * Build the row without sending it — pure, so a test can walk the whole
 * catalogue. The SHAPE lives in `@artifactbin/utils` (one builder for both
 * processes); this is the app saying which of them is speaking.
 */
export function envelope<K extends ObjectKind, V extends EventVerb<K>>(
  subject: EventSubject | null,
  verb: V,
  object: EventObject<K>,
  payload: EventPayload<K, V>,
): EventEnvelope {
  return build('app', subject, verb, object, payload);
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
