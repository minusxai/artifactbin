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

/**
 * THE NAMING RULE for everything this package interpolates into SQL. A schema
 * reaches DDL as text, never as a
 * parameter, so the grammar is stated ONCE here and every caller in the
 * package tests against this one regex.
 */
export const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

const EVENTS_TABLE: Table = {
  name: 'events',
  columns: [
    /** Emitter-minted uuid — the dedupe key: a retried batch inserts ON CONFLICT DO NOTHING. */
    { name: 'id', type: 'TEXT', notNull: true },
    { name: 'at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
    /** 'app' | 'auth' | 'proxy' */
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
    /**
     * THE FEED POSITION: assigned by this service when it durably accepts the row (never the emitter's `at`), from
     * the one-row `feed_head` counter inside the same statement, so appends serialize on that row through commit and
     * a reader that sees position p has already seen every position below it. Strictly increasing per installation,
     * not dense (a duplicate id in a batch spends one). NULL only on rows stored before positions existed, until the
     * next boot's ensure numbers them.
     */
    { name: 'position', type: 'BIGINT' },
    /** When this service accepted the row (clock time at append): the public feed's retention is measured on it. */
    { name: 'accepted_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
  ],
  primaryKey: ['id'],
  indexes: [
    /** "what happened to what I own" */
    { name: 'idx_events_object_at', columns: ['object_id', 'at'] },
    /** "what did those I follow do"; DISTINCT subject_id per day = the view count */
    { name: 'idx_events_subject_at', columns: ['subject_id', 'at'] },
    /** the forwarding rules and the catalogue tests */
    { name: 'idx_events_kind_verb_at', columns: ['object_kind', 'verb', 'at'] },
    /** the public feed: the installation-wide resume point, and its expiry check */
    { name: 'idx_events_position', columns: ['position'], unique: true },
    /** the public feed for one resource (`artifact_id=`) */
    { name: 'idx_events_object_position', columns: ['object_id', 'position'] },
    /** the public feed for some event types (`category=`, `types=`) */
    { name: 'idx_events_kind_verb_position', columns: ['object_kind', 'verb', 'position'] },
    /** the public feed's retention: where the retained feed starts */
    { name: 'idx_events_accepted_position', columns: ['accepted_at', 'position'] },
  ],
};

/**
 * The feed's append counter: ONE row, `position` the highest position handed out. Every append does
 * `UPDATE … SET position = position + n RETURNING` first, so concurrent appends queue on the row lock and each sees
 * the previous one's committed value (READ COMMITTED re-reads a row it waited for). Never read by the app.
 */
const FEED_HEAD_TABLE: Table = {
  name: 'feed_head',
  columns: [
    { name: 'id', type: 'INTEGER', notNull: true },
    { name: 'position', type: 'BIGINT', notNull: true, default: '0' },
  ],
  primaryKey: ['id'],
};

const DELIVERIES_TABLE: Table = {
  name: 'deliveries', columns: [
    {name:'event_id',type:'TEXT',notNull:true}, {name:'subscriber',type:'TEXT',notNull:true},
    {name:'available_at',type:'TIMESTAMPTZ',notNull:true,default:'now()'},
    {name:'attempts',type:'INTEGER',notNull:true,default:'0'},
    {name:'claim',type:'TEXT'}, {name:'delivered_at',type:'TIMESTAMPTZ'},
  ], primaryKey:['event_id','subscriber'],
  indexes:[{name:'idx_delivery_pending',columns:['subscriber','available_at'],where:'delivered_at IS NULL'}],
};
export const EVENTS_TABLES: Table[] = [EVENTS_TABLE, DELIVERIES_TABLE, FEED_HEAD_TABLE];
