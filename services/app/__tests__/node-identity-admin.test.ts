import { describe, expect, it } from 'vitest';
import { useAppHarness } from './harness';
import { createAppServer } from '@/server/app';

const harness = useAppHarness();
const app = createAppServer();

describe('migration HTTP endpoints are removed', () => {
  it.each(['/api/admin/node-identity', '/api/admin/dataset-catalog'])('%s is absent even with the operator credential', async (endpoint) => {
    const db = await harness.db();
    await db.query(`INSERT INTO artifacts (id,token_id,content,source,format)
      VALUES ('aaaaaa','tok_admin','','<p>Legacy</p>','markup')`);
    const before = (await db.query('SELECT * FROM artifacts')).rows;
    const credentials: Record<string, string>[] = [{}, { 'x-shared-secret': 'wrong' }, { 'x-shared-secret': 'test-secret' }, { authorization: 'Bearer test-secret' }];
    for (const headers of credentials) {
      const response = await app.request(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ batchSize: 1, dryRun: false, expected: {} }),
      });
      expect(response.status).toBe(404);
    }
    expect((await db.query('SELECT * FROM artifacts')).rows).toEqual(before);
    expect((await db.query('SELECT * FROM node_identity_migration_jobs')).rows).toHaveLength(0);
  });
});
