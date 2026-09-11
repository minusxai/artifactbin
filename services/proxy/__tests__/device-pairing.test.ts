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
