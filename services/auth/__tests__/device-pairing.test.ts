import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureAuthSchema } from '../src/schema';
import { createDevicePairing } from '../src/identity/device-pairing';

const pg = new PGlite();
const store = createDevicePairing(pg);
beforeAll(async () => { await ensureAuthSchema(pg, 'auth'); });
afterAll(async () => { await pg.close(); });
describe('durable browser pairing', () => {
  it('keeps the polling secret out of browser data and requires explicit approval', async () => {
    const pair = await store.begin('https://example.com');
    expect(await store.consume(pair.deviceCode, 'https://example.com')).toEqual({ status: 'pending' });
    const shown = await store.inspect(pair.userCode, 'https://example.com');
    expect(shown).toEqual({ userCode: pair.userCode });
    const rows = await pg.query('SELECT credential_hash, payload FROM auth.credentials');
    expect(JSON.stringify(rows.rows)).not.toContain(pair.deviceCode);
    expect(await store.approve(pair.userCode, 'https://evil.com', 'usr_other')).toBe(false);
    expect(await store.approve(pair.userCode, 'https://example.com', 'usr_one')).toBe(true);
    expect(await store.approve(pair.userCode, 'https://example.com', 'usr_other')).toBe(false);
    expect(await store.consume(pair.deviceCode, 'https://evil.com')).toEqual({ status: 'invalid' });
    const outcomes = await Promise.all([store.consume(pair.deviceCode, 'https://example.com'), store.consume(pair.deviceCode, 'https://example.com')]);
    expect(outcomes).toContainEqual({ status: 'approved', userId: 'usr_one' });
    expect(outcomes).toContainEqual({ status: 'invalid' });
  });
  it('expires approval and polling together and survives a new store instance', async () => {
    const pair = await store.begin('https://example.com');
    expect(await createDevicePairing(pg).inspect(pair.userCode, 'https://example.com')).not.toBeNull();
    await pg.query("UPDATE auth.credentials SET expires_at = now() - interval '1 second'");
    expect(await store.inspect(pair.userCode, 'https://example.com')).toBeNull();
    expect(await store.approve(pair.userCode, 'https://example.com', 'usr_one')).toBe(false);
    expect(await store.consume(pair.deviceCode, 'https://example.com')).toEqual({ status: 'invalid' });
  });
});

it('reports browser denial to the initiating CLI without granting credentials',async()=>{
 const pair=await store.begin('https://example.com');
 expect(await store.deny(pair.userCode,'https://evil.com')).toBe(false);
 expect(await store.deny(pair.userCode,'https://example.com')).toBe(true);
 expect(await store.consume(pair.deviceCode,'https://example.com')).toEqual({status:'denied'});
 expect(await store.approve(pair.userCode,'https://example.com','usr_one')).toBe(false);
});

describe('email account approval', () => {
  it('carries an artifact target and verified account through one-time consumption', async () => {
    const target = { artifactId: 'ABC123' };
    const owner = { credential: 'session' as const, userId: 'usr_account', email: 'mxmx_test_pair@example.com', emailVerified: true };
    const pair = await store.begin('https://example.com', target);
    expect(await store.approve(pair.userCode, 'https://example.com', owner.userId, owner)).toBe(true);
    expect(await store.consume(pair.deviceCode, 'https://example.com')).toEqual({ status: 'approved', userId: owner.userId, target, approvedBy: owner });
    expect(await store.consume(pair.deviceCode, 'https://example.com')).toEqual({ status: 'invalid' });
  });
  it('rejects persisted anonymous approvals from before the migration', async () => {
    const pair = await store.begin('https://example.com');
    await pg.query(`UPDATE auth.credentials SET payload = payload || '{"anon":true}'::jsonb`);
    expect(await store.consume(pair.deviceCode, 'https://example.com')).toEqual({ status: 'invalid' });
  });
});

describe('an approval that lands in the middle of a poll', () => {
  // `consume` asks two questions in turn: is it approved (and claim it), else is it still pending.
  // An approval between the two made the first say "not yet" and the second say "no longer", and the
  // poll answered `invalid` — which the CLI reports as an expired approval and gives up on.
  const approvingBetween = (approve: () => Promise<boolean>) => {
    let claims = 0;
    const racing = { query: async (sql: string, params?: unknown[]) => {
      const result = await pg.query(sql, params as never[]);
      if (/SET consumed_at/.test(sql) && ++claims === 1) expect(await approve()).toBe(true);
      return result;
    } };
    return createDevicePairing(racing as never);
  };

  it('answers pending, and the next poll claims the account approval', async () => {
    const pair = await store.begin('https://example.com');
    const racing = approvingBetween(() => store.approve(pair.userCode, 'https://example.com', 'usr_race'));
    expect(await racing.consume(pair.deviceCode, 'https://example.com')).toEqual({ status: 'pending' });
    expect(await racing.consume(pair.deviceCode, 'https://example.com')).toEqual({ status: 'approved', userId: 'usr_race' });
  });

});
