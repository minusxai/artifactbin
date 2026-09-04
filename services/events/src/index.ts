/**
 * THE EVENTS SERVICE, from the outside: the contract (re-exported from
 * @artifactbin/contracts), the table it owns, the HTTP client that speaks the
 * wire (utils' eventsClient), the server shell that serves ANY EventsService
 * over it, and the boot a process entry or a deployment wrapper calls. No
 * database here — the writer is `@artifactbin/events/local`.
 */
import type { EventsService, EventSink, Queryable } from '@artifactbin/contracts';
import { type JsonServer } from '@artifactbin/utils';

export type * from '@artifactbin/contracts';
export { EVENTS_ROUTES, EVENT_VERBS, eventName } from '@artifactbin/contracts';
export { eventsClient, type EventsClientOptions } from '@artifactbin/utils';
export { DEFAULT_EVENTS_SCHEMA, EVENTS_TABLE, EVENTS_TABLES } from './schema';

/**
 * One POST (`/emit`, a JSON array of envelopes → `{ stored: n }`) plus
 * `GET /health`, answered BEFORE the secret check so the Docker HEALTHCHECK
 * works with a secret set. Mirrors services/sql's shell line for line: the
 * secret guard, the method guard, the body cap, the name-only error.
 */
export function serveEvents(svc: EventsService, opts: { maxBody?: number; serviceSecret?: string } = {}): JsonServer {
  void svc; void opts;
  throw new Error('events-svc: implement serveEvents');
}

/** What the process needs, resolved from the environment by `loadEventsConfig`. */
export interface EventsConfig {
  /** APP__PORT, default 8080; 0 = ephemeral. */
  port: number;
  /** APP__HOST, default 0.0.0.0. */
  host?: string;
  /** DATABASE_URL — the events role's own connection. Required unless a `db` is injected at run. */
  databaseUrl?: string;
  /** EVENTS__SCHEMA, default `events`. */
  schema: string;
  /** INTERNAL__SERVICE_SECRET — required in production (utils serviceSecretForServer). */
  serviceSecret?: string;
  /** MODULE__NAME settings of our shape that nothing read — a typo, reported at boot. */
  unknownNames: string[];
}

export interface LoadEventsConfigOptions {
  /** Names that MUST be present; every missing one is named in ONE error. */
  required?: string[];
  /** Names the CALLER reads itself (a deployment wrapper's own settings), so the audit does not report them unknown. */
  known?: string[];
}

/** Read the process environment into an EventsConfig. Pure: a test hands it a plain object. */
export function loadEventsConfig(source: Record<string, string | undefined>, opts: LoadEventsConfigOptions = {}): EventsConfig {
  void source; void opts;
  throw new Error('events-svc: implement loadEventsConfig');
}

/** How a deployment composes against the OSS boot: the sinks, and (tests only) the database. */
export interface EventsOverrides {
  sinks?: EventSink[];
  /** A Queryable to write through instead of a pg Pool on `databaseUrl` — tests and the single image. */
  db?: Queryable;
}

export interface RunningEvents {
  url: string;
  /** Stops the socket, then the pool; idempotent. Never installs signal handlers — the entry's job. */
  close(): Promise<void>;
}

/**
 * Boot: config → writer (schema ensured) → shell → listening socket. Logs the
 * unknown-name warnings the way the proxy's runStandalone does, under `events`.
 */
export async function runEvents(config: EventsConfig, overrides: EventsOverrides = {}): Promise<RunningEvents> {
  void config; void overrides;
  throw new Error('events-svc: implement runEvents');
}
