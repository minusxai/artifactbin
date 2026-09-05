/**
 * THE ONE BUILDER of a log sentence. Two processes say things about the same
 * world — the app (`services/app/lib/events.ts`) and the proxy
 * (`services/proxy/src/events.ts`) — and a row shape written twice is a row
 * shape that drifts: one side stamps `at` in a different format, one side
 * forgets that a missing subject is TWO nulls rather than two absent columns,
 * and the log stops being one table anyone can read.
 *
 * So the envelope is built HERE, and `source` is the only thing the two
 * callers disagree about. Pure: no clock injection, no service, no I/O — a
 * test can walk the whole catalogue through it.
 *
 * The sentence is typed by the catalogue (`@artifactbin/contracts`
 * EVENT_VERBS): a verb the object kind does not take, or a payload of the
 * wrong shape, is a compile error rather than a bad row.
 */
import { randomUUID } from 'node:crypto';
import type { EventEnvelope, EventPayload, EventSource, EventVerb, ObjectKind, SubjectKind } from '@artifactbin/contracts';

/** Who did it. `null` at the call site means "nobody we can name" — an anonymous door denial, a code sent to an address that has no account yet. */
export interface EventSubject { kind: SubjectKind; id: string }
/** What it was done to. The kind PICKS the verbs and the payload shape. */
export interface EventObject<K extends ObjectKind = ObjectKind> { kind: K; id: string }

/** Build the row without sending it. `source` says which process is speaking; everything else is the sentence. */
export function envelope<K extends ObjectKind, V extends EventVerb<K>>(
  source: EventSource,
  subject: EventSubject | null,
  verb: V,
  object: EventObject<K>,
  payload: EventPayload<K, V>,
): EventEnvelope {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    source,
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
