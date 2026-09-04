/**
 * THE PROXY'S VOICE in the log: the same sentence the app builds (lib/events),
 * with `source: 'proxy'`. `say` never rejects and is never awaited on a
 * request's path — a door's verdict or a login must not wait on telemetry.
 * The moments the proxy owns: a login code SENT (loginRoutes, after the door
 * let it through and Better Auth answered), a door DENIED (both denial sites
 * in parts.ts), and — through Better Auth's database hooks in auth/human.ts —
 * a user CREATED (`signed_up`), a session CREATED (`login_verified`), an OAuth
 * account LINKED (`oauth_linked`).
 */
import type { EventEnvelope, EventPayload, EventsService, EventVerb, ObjectKind, SubjectKind } from '@artifactbin/contracts';

export interface ProxySubject { kind: SubjectKind; id: string }
export interface ProxyObject<K extends ObjectKind = ObjectKind> { kind: K; id: string }

/** Build the row without sending it — pure, the app's `envelope` with the proxy as the source. */
export function proxyEnvelope<K extends ObjectKind, V extends EventVerb<K>>(
  subject: ProxySubject | null,
  verb: V,
  object: ProxyObject<K>,
  payload: EventPayload<K, V>,
): EventEnvelope {
  void subject; void verb; void object; void payload;
  throw new Error('events-proxy: implement proxyEnvelope');
}

/** Fire-and-forget: never rejects, never throws; an absent service is a noop. Callers write `void say(...)`. */
export async function say<K extends ObjectKind, V extends EventVerb<K>>(
  events: EventsService | undefined,
  subject: ProxySubject | null,
  verb: V,
  object: ProxyObject<K>,
  payload: EventPayload<K, V>,
): Promise<void> {
  void events; void subject; void verb; void object; void payload;
  throw new Error('events-proxy: implement say');
}
