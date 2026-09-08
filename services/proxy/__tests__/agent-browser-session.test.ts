import {beforeAll, describe, expect, it} from 'vitest';
import {createAgentBrowserSessions} from '../src/auth/agent-browser-session';
import {ensureTestSchema, testDb} from './helpers';

beforeAll(ensureTestSchema);
describe('per-browser anonymous sessions', () => {
  it('keeps two browsers holding the same token independent and revokes retained browser nonces', async () => {
    const sessions = createAgentBrowserSessions(testDb());
    await sessions.register('a'.repeat(43), 'tok_shared');
    await sessions.register('b'.repeat(43), 'tok_shared');
    await sessions.revoke('a'.repeat(43));
    expect(await sessions.live('a'.repeat(43), 'tok_shared')).toBe(false);
    expect(await sessions.live('b'.repeat(43), 'tok_shared')).toBe(true);
    expect(await sessions.live('b'.repeat(43), 'tok_other')).toBe(false);
  });
  it('stores hashes only and checks expiry, token binding and malformed nonces', async () => {
    const sessions = createAgentBrowserSessions(testDb());
    const nonce = 'c'.repeat(43); await sessions.register(nonce,'tok_expiring');
    const rows = (await testDb().query("SELECT * FROM auth.credentials WHERE kind IN ('agent-browser','read-agent')")).rows;
    expect(JSON.stringify(rows)).not.toContain(nonce);
    await testDb().query("UPDATE auth.credentials SET expires_at=now()-interval '1 second' WHERE kind='agent-browser' AND subject_id='tok_expiring'");
    expect(await sessions.live(nonce, 'tok_expiring')).toBe(false);
    await expect(sessions.register('malformed', 'tok_x')).rejects.toThrow();
  });
});
