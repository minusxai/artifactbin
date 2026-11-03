/** Retired storage on an existing database: boot drops the undeclared tables and columns, and a second boot is a no-op. */
// harness-exempt: boots the schema statements on its own in-memory PGLite, with retired storage seeded first
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { DROPPED_TABLES, SCHEMA_STATEMENTS } from '../schema';

it('drops the retired resolver store, the connected-dataset secrets and cache, the api column and the other retired tables from a database that still has them', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE html_backend_stores (backend_id TEXT, key TEXT, value JSONB);
      INSERT INTO html_backend_stores VALUES ('b', 'k', '{}');
      CREATE TABLE html_backend_versions (backend_id TEXT NOT NULL, version TEXT NOT NULL, api INTEGER, PRIMARY KEY (backend_id, version));
      CREATE TABLE browser_test_users (session_id TEXT, owner TEXT);
      CREATE TABLE notification_jobs (id TEXT PRIMARY KEY, input JSONB);
      CREATE TABLE mutation_notifications (id TEXT PRIMARY KEY, job_id TEXT);
      CREATE TABLE dataset_secrets (id TEXT PRIMARY KEY, dataset_id TEXT, ciphertext TEXT NOT NULL);
      CREATE INDEX idx_dataset_secrets_dataset ON dataset_secrets (dataset_id);
      INSERT INTO dataset_secrets VALUES ('s', 'd', 'x');
      CREATE TABLE dataset_result_cache (cache_key TEXT PRIMARY KEY, result JSONB);
      INSERT INTO dataset_result_cache VALUES ('k', '{}');`);
    const tables = async () => (await db.query<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()")).rows.map(row => row.name);
    const columns = async () => (await db.query<{ name: string }>("SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'html_backend_versions'")).rows.map(row => row.name);
    for (let boot = 0; boot < 2; boot++) {
      for (const statement of SCHEMA_STATEMENTS) await db.query(statement);
      const present = await tables();
      expect(present).toContain('html_backend_versions');
      expect(DROPPED_TABLES).toEqual(expect.arrayContaining(['dataset_secrets', 'dataset_result_cache']));
      for (const name of DROPPED_TABLES) expect(present).not.toContain(name);
      expect(await columns()).not.toContain('api');
    }
  } finally { await db.close(); }
});
