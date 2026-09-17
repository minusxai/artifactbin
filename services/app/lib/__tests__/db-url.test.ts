/**
 * ONE database env — DATABASE_URL — with scheme dispatch:
 *   unset/empty            → embedded PGLite at ./data/pglite (zero-config dev)
 *   pglite://<path>        → embedded PGLite at <path> (taken literally;
 *                            relative or absolute), pglite://memory → in-memory
 *   postgresql://… (else)  → external Postgres, URL passed to pg verbatim
 *                            (database, user, and search_path/schema are all
 *                            the caller's choice — the boot DDL applies to
 *                            whatever the URL points at)
 * No DB_TYPE, no PGLITE_DATA_DIR: the URL is the type.
 */
import { describe, expect, it } from 'vitest';
import { databaseTargetForRuntime, parseDatabaseUrl } from '../db';

describe('parseDatabaseUrl', () => {
  it('defaults to embedded PGLite at ./data/pglite when unset or empty', () => {
    expect(parseDatabaseUrl(undefined)).toEqual({ engine: 'pglite', dataDir: './data/pglite' });
    expect(parseDatabaseUrl('')).toEqual({ engine: 'pglite', dataDir: './data/pglite' });
    expect(parseDatabaseUrl('   ')).toEqual({ engine: 'pglite', dataDir: './data/pglite' });
  });

  it('anchors only the implicit store to the app instead of the process cwd', () => {
    expect(databaseTargetForRuntime(undefined, '/repo/services/app')).toEqual({
      engine: 'pglite',
      dataDir: '/repo/services/app/data/pglite',
    });
    expect(databaseTargetForRuntime('', '/repo/services/app')).toEqual({
      engine: 'pglite',
      dataDir: '/repo/services/app/data/pglite',
    });
    expect(databaseTargetForRuntime('pglite://./mine', '/repo/services/app')).toEqual({
      engine: 'pglite',
      dataDir: './mine',
    });
  });

  it('pglite://<path> selects PGLite with the path taken literally', () => {
    expect(parseDatabaseUrl('pglite://./data/pglite')).toEqual({ engine: 'pglite', dataDir: './data/pglite' });
    expect(parseDatabaseUrl('pglite:///app/data/pglite')).toEqual({ engine: 'pglite', dataDir: '/app/data/pglite' });
    expect(parseDatabaseUrl('pglite://relative/path')).toEqual({ engine: 'pglite', dataDir: 'relative/path' });
  });

  it('pglite://memory selects the in-memory instance', () => {
    expect(parseDatabaseUrl('pglite://memory')).toEqual({ engine: 'pglite', dataDir: null });
  });

  it('postgres URLs select the pg engine verbatim', () => {
    const url = 'postgresql://artifact_bin@postgres:5432/artifact_bin';
    expect(parseDatabaseUrl(url)).toEqual({ engine: 'pg', url });
    const withSchema = 'postgresql://u:p@host/db?options=-csearch_path%3Dartifacts';
    expect(parseDatabaseUrl(withSchema)).toEqual({ engine: 'pg', url: withSchema });
  });
});
