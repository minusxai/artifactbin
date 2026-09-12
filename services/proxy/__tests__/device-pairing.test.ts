import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureProxySchema } from '../src/schema';
import { createDevicePairing } from '../src/identity/device-pairing';

const pg = new PGlite();
const store = createDevicePairing(pg);
beforeAll(async () => { await ensureProxySchema(pg, 'auth'); });
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

describe('anonymous browser approval', () => {
  it('approves without an account and the CLI consumes an approval bearing no user', async () => {
    const pair = await store.begin('https://example.com');
    // Origin-bound like the account path: a foreign origin cannot approve.
    expect(await store.approveAnonymously(pair.userCode, 'https://evil.com')).toBe(false);
    expect(await store.approveAnonymously(pair.userCode, 'https://example.com')).toBe(true);
    // An anonymous-approved pairing is settled: it no longer renders as
    // approvable, cannot be claimed by a real account, and cannot be denied.
    expect(await store.inspect(pair.userCode, 'https://example.com')).toBeNull();
    expect(await store.approve(pair.userCode, 'https://example.com', 'usr_one')).toBe(false);
    expect(await store.deny(pair.userCode, 'https://example.com')).toBe(false);
    // Consumed once, and it carries no user identity.
    const outcomes = await Promise.all([
      store.consume(pair.deviceCode, 'https://example.com'),
      store.consume(pair.deviceCode, 'https://example.com'),
    ]);
    expect(outcomes).toContainEqual({ status: 'approved', userId: null });
    expect(outcomes).toContainEqual({ status: 'invalid' });
  });

  it('single-use across mixed paths: a user approval and an anonymous approval never both take', async () => {
    const userFirst = await store.begin('https://example.com');
    expect(await store.approve(userFirst.userCode, 'https://example.com', 'usr_one')).toBe(true);
    // A user-approved pairing cannot be downgraded to anonymous.
    expect(await store.approveAnonymously(userFirst.userCode, 'https://example.com')).toBe(false);
    expect(await store.consume(userFirst.deviceCode, 'https://example.com')).toEqual({ status: 'approved', userId: 'usr_one' });

    const anonFirst = await store.begin('https://example.com');
    expect(await store.approveAnonymously(anonFirst.userCode, 'https://example.com')).toBe(true);
    // A second anonymous approval, and a user approval on top, both refused.
    expect(await store.approveAnonymously(anonFirst.userCode, 'https://example.com')).toBe(false);
    expect(await store.approve(anonFirst.userCode, 'https://example.com', 'usr_two')).toBe(false);
    expect(await store.consume(anonFirst.deviceCode, 'https://example.com')).toEqual({ status: 'approved', userId: null });
  });

  it('an expired pairing cannot be approved anonymously', async () => {
    const pair = await store.begin('https://example.com');
    await pg.query("UPDATE auth.credentials SET expires_at = now() - interval '1 second'");
    expect(await store.approveAnonymously(pair.userCode, 'https://example.com')).toBe(false);
    expect(await store.consume(pair.deviceCode, 'https://example.com')).toEqual({ status: 'invalid' });
  });
});
