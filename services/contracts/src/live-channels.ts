/**
 * THE LIVE CHANNEL NAMES — the Postgres LISTEN/NOTIFY channel a document's
 * wakeups ride on, and the separate one for its annotations (a comment must not
 * wake every reader's document catch-up). One formula, used by the listener
 * (lib/publish/realtime/live), the events authorizer and every TypeScript
 * pg_notify. Writes that notify from inside SQL spell the same formula as
 * `'artifact_' || lower(id)`; services/app/__tests__/live-channels.test.ts holds
 * the two to one answer.
 *
 * Artifact ids are [a-zA-Z0-9]+, safe as channel identifiers — but LOWERCASED,
 * because unquoted LISTEN folds the channel name to lowercase (PGLite always
 * emits it unquoted) while pg_notify's payload is exact text: with a mixed-case
 * id the notification would silently never reach the listener in dev/CI while
 * working on production Postgres. Two ids differing only in case sharing a
 * channel is harmless — every wakeup is a catch-up read keyed by the real id.
 */
export const artifactChannel = (artifactId: string): string => `artifact_${artifactId.toLowerCase()}`;

/** The annotations sidecar's own channel. */
export const annotationsChannel = (artifactId: string): string => `annotations_${artifactId.toLowerCase()}`;
