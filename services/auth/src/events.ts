/** Login lifecycle events, independent of deployment transport. */
import type { EventEnvelope, EventPayload, EventsService, EventVerb, ObjectKind } from '@artifactbin/contracts';
import { envelope, type EventObject, type EventSubject } from '@artifactbin/utils';

export type AuthSubject = EventSubject;
type AuthObject<K extends ObjectKind = ObjectKind> = EventObject<K>;

/** Build the row without sending it — pure, the app's `envelope` with the auth as the source. */
export function authEnvelope<K extends ObjectKind, V extends EventVerb<K>>(
  subject: AuthSubject | null,
  verb: V,
  object: AuthObject<K>,
  payload: EventPayload<K, V>,
): EventEnvelope {
  return envelope('auth', subject, verb, object, payload);
}

/** Fire-and-forget: never rejects, never throws; an absent service is a noop. Callers write `void say(...)`. */
export async function say<K extends ObjectKind, V extends EventVerb<K>>(
  events: EventsService | undefined,
  subject: AuthSubject | null,
  verb: V,
  object: AuthObject<K>,
  payload: EventPayload<K, V>,
): Promise<void> {
  if (!events) return;
  try {
    await events.emit([authEnvelope(subject, verb, object, payload)]);
  } catch (error) {
    // Telemetry never takes a request down with it, and an unhandled rejection
    // out of a `void say(...)` would kill the process.
    console.error('[events] say failed:', error);
  }
}
