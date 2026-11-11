/**
 * THE HARNESS'S ONE DATABASE PER WORKER (harness.ts, `harnessReusesDatabase` in the api project): each describe below
 * calls `useAppHarness()`, so its hooks run exactly as a file's do, and the describes run in order on one worker,
 * as consecutive files do. A "file" that leaves rows, a sequence's value, a temporary table, a session setting and a
 * held advisory lock hands the next one the SAME database with none of them; one that changes what a wipe cannot
 * undo (a table, a LISTEN) hands the next one a fresh database. Each case is set up by one describe and checked by
 * the next, before the next one's per-test wipe could hide anything, so the describes are never shuffled.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { mintAccountToken, useAppHarness } from './harness';
import type { Db } from '@/lib/platform/db';

describe('consecutive files on one worker', { shuffle: false }, () => {
  let first: Db | undefined;
  let sequence: string;

  describe('a file that leaves what the recycle undoes', () => {
    const h = useAppHarness();
    it('leaves rows, a sequence value, a temporary table, a session setting and an advisory lock', async () => {
      const db = await h.db();
      first = db;
      await mintAccountToken('reuse_left_behind');
      sequence = (await db.query<{ s: string }>("SELECT format('%I.%I',schemaname,sequencename) AS s FROM pg_sequences ORDER BY 1 LIMIT 1")).rows[0]!.s;
      await db.query('SELECT nextval($1::regclass), nextval($1::regclass)', [sequence]);
      await db.query('CREATE TEMP TABLE reuse_scratch (a int)');
      await db.query("SET work_mem = '7MB'");
      await db.query('SELECT pg_advisory_lock(424242)');
      expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users')).rows[0]!.n).toBeGreaterThan(0);
    });
  });

  describe('the next file', () => {
    const h = useAppHarness();
    const seen: Record<string, unknown> = {};
    // Registered after the harness's own beforeAll, so this reads the database the file starts on, before any wipe.
    beforeAll(async () => {
      const db = await h.db();
      seen.same = db === first;
      seen.users = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users')).rows[0]!.n;
      seen.tokens = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM tokens')).rows[0]!.n;
      seen.next = (await db.query<{ n: string }>('SELECT nextval($1::regclass)::text AS n', [sequence])).rows[0]!.n;
      seen.temp = (await db.query<{ t: string | null }>("SELECT to_regclass('pg_temp.reuse_scratch')::text AS t")).rows[0]!.t;
      seen.workMem = (await db.query<{ w: string }>("SELECT current_setting('work_mem') AS w")).rows[0]!.w;
      seen.locks = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'")).rows[0]!.n;
    });
    it('gets the same database in a fresh one\'s state: no rows, the sequence at its start, no temp table, default settings, no lock', () => {
      expect(seen).toEqual({ same: true, users: 0, tokens: 0, next: '1', temp: null, workMem: '4MB', locks: 0 });
    });
  });

  let changed: Db | undefined;

  describe('a file that changes what a wipe cannot undo', () => {
    const h = useAppHarness();
    it('creates a table', async () => {
      const db = await h.db();
      changed = db;
      await db.query('CREATE TABLE public.reuse_leftover (a int)');
    });
  });

  describe('the file after it', () => {
    const h = useAppHarness();
    const seen: Record<string, unknown> = {};
    beforeAll(async () => {
      const db = await h.db();
      seen.same = db === changed;
      seen.table = (await db.query<{ t: string | null }>("SELECT to_regclass('public.reuse_leftover')::text AS t")).rows[0]!.t;
      seen.listening = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM pg_listening_channels()')).rows[0]!.n;
    });
    it('gets a fresh database: no table', () => {
      expect(seen).toEqual({ same: false, table: null, listening: 0 });
    });
  });

  let listened: Db | undefined;

  describe('a file that leaves a LISTEN open', () => {
    const h = useAppHarness();
    it('listens and never unlistens', async () => {
      listened = await h.db();
      await listened.listen('reuse_channel', () => {});
    });
  });

  describe('the file after that', () => {
    const h = useAppHarness();
    const seen: Record<string, unknown> = {};
    beforeAll(async () => {
      const db = await h.db();
      seen.same = db === listened;
      seen.listening = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM pg_listening_channels()')).rows[0]!.n;
    });
    it('gets a fresh database: nothing listening', () => {
      expect(seen).toEqual({ same: false, listening: 0 });
    });
  });
});
