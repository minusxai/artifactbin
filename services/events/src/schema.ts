/**
 * THE ONE TABLE this service owns, as data (the contract's Table shape; utils
 * renders it). Lives in the schema the deployment names (`EVENTS__SCHEMA`,
 * default `events`), which this service creates when absent and nobody else
 * writes: the app reads it with SELECT through a grant, exactly as the proxy
 * reads the app's tokens table.
 *
 * The row is a sentence — subject, verb, object — plus id/at/source/payload;
 * see @artifactbin/contracts events.ts for why the object is always the thing
 * whose owner cares.
 */
import type { Table } from '@artifactbin/contracts';

export const DEFAULT_EVENTS_SCHEMA = 'events';

export const EVENTS_TABLE: Table = {
  name: 'events',
  columns: [
    /** Emitter-minted uuid — the dedupe key: a retried batch inserts ON CONFLICT DO NOTHING. */
    { name: 'id', type: 'TEXT', notNull: true },
    { name: 'at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
    /** 'app' | 'proxy' */
    { name: 'source', type: 'TEXT', notNull: true },
    /** 'user' | 'token' | 'visitor' (the daily hash); NULL when nobody did it. */
    { name: 'subject_kind', type: 'TEXT' },
    { name: 'subject_id', type: 'TEXT' },
    /** Past tense, a closed union per object_kind (contracts EVENT_VERBS). */
    { name: 'verb', type: 'TEXT', notNull: true },
    /** 'artifact' | 'user' | 'token' | 'door' | 'route' */
    { name: 'object_kind', type: 'TEXT', notNull: true },
    { name: 'object_id', type: 'TEXT', notNull: true },
    /** The rest — ids and names only: {fork_id}, {annotation_id}, {client}. Never content, never a secret. */
    { name: 'payload', type: 'JSONB', notNull: true, default: "'{}'" },
  ],
  primaryKey: ['id'],
  indexes: [
    /** "what happened to what I own" */
    { name: 'idx_events_object_at', columns: ['object_id', 'at'] },
    /** "what did those I follow do"; DISTINCT subject_id per day = the view count */
    { name: 'idx_events_subject_at', columns: ['subject_id', 'at'] },
    /** the forwarding rules and the catalogue tests */
    { name: 'idx_events_kind_verb_at', columns: ['object_kind', 'verb', 'at'] },
  ],
};

export const EVENTS_TABLES: Table[] = [EVENTS_TABLE];
