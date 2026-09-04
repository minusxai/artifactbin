/**
 * THE PROXY'S VOICE in the log: the same sentence the app builds (lib/events),
 * with `source: 'proxy'`. `say` never rejects and is never awaited on a
 * request's path — a door's verdict or a login must not wait on telemetry.
 * The moments the proxy owns: a login code SENT (loginRoutes, after the door
 * let it through and Better Auth answered), a door DENIED (both denial sites
 * in parts.ts), and — through Better Auth's database hooks in auth/human.ts —
 * a user CREATED (`signed_up`), a session CREATED (`login_verified`), an OAuth
 * account LINKED (`oauth_linked`).
 *
 * The ROW SHAPE is not built here: `@artifactbin/utils` owns the ONE builder
 * both processes call (utils/src/events.ts), so the log stays one table that
 * one reader can read — `source` is the only thing the two callers disagree
 * about.
 */
import type { EventEnvelope, EventPayload, EventsService, EventVerb, ObjectKind } from '@artifactbin/contracts';
import { envelope, type EventObject, type EventSubject } from '@artifactbin/utils';

export type ProxySubject = EventSubject;
export type ProxyObject<K extends ObjectKind = ObjectKind> = EventObject<K>;

/** Build the row without sending it — pure, the app's `envelope` with the proxy as the source. */
export function proxyEnvelope<K extends ObjectKind, V extends EventVerb<K>>(
  subject: ProxySubject | null,
  verb: V,
  object: ProxyObject<K>,
  payload: EventPayload<K, V>,
): EventEnvelope {
  return envelope('proxy', subject, verb, object, payload);
}

/** Fire-and-forget: never rejects, never throws; an absent service is a noop. Callers write `void say(...)`. */
export async function say<K extends ObjectKind, V extends EventVerb<K>>(
  events: EventsService | undefined,
  subject: ProxySubject | null,
  verb: V,
  object: ProxyObject<K>,
  payload: EventPayload<K, V>,
): Promise<void> {
  if (!events) return;
  try {
    await events.emit([proxyEnvelope(subject, verb, object, payload)]);
  } catch (error) {
    // Telemetry never takes a request down with it, and an unhandled rejection
    // out of a `void say(...)` would kill the process.
    console.error('[events] say failed:', error);
  }
}
