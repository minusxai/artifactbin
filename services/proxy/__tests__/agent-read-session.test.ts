import {beforeAll, describe, expect, it} from 'vitest';
import {createAgentReadSessions} from '../src/auth/agent-read-session';
import {ensureTestSchema, testDb} from './helpers';

beforeAll(ensureTestSchema);
describe('per-browser anonymous read sessions', () => {
  it('keeps two browsers holding the same token independent and revokes retained read handles', async () => {
    const sessions = createAgentReadSessions(testDb());
    const first = await sessions.issue('a'.repeat(43), 'tok_shared');
    const second = await sessions.issue('b'.repeat(43), 'tok_shared');
    expect(await sessions.resolve(first.token)).toBe('tok_shared');
    expect(await sessions.resolve(second.token)).toBe('tok_shared');
    await sessions.revoke('a'.repeat(43));
    expect(await sessions.resolve(first.token)).toBeNull();
    expect(await sessions.live('a'.repeat(43), 'tok_shared')).toBe(false);
    expect(await sessions.resolve(second.token)).toBe('tok_shared');
    expect(await sessions.live('b'.repeat(43), 'tok_shared')).toBe(true);
    expect(await sessions.live('b'.repeat(43), 'tok_other')).toBe(false);
  });
  it('stores hashes only and checks expiry, token binding and malformed handles', async () => {
    const sessions = createAgentReadSessions(testDb());
    const nonce = 'c'.repeat(43), issued = await sessions.issue(nonce, 'tok_expiring');
    const rows = (await testDb().query("SELECT * FROM auth.credentials WHERE kind IN ('agent-browser','read-agent')")).rows;
    expect(JSON.stringify(rows)).not.toContain(nonce);
    expect(JSON.stringify(rows)).not.toContain(issued.token);
    expect(await sessions.resolve(nonce)).toBeNull();
    await testDb().query("UPDATE auth.credentials SET expires_at=now()-interval '1 second' WHERE kind='agent-browser' AND subject_id='tok_expiring'");
    expect(await sessions.resolve(issued.token)).toBeNull();
    expect(await sessions.live(nonce, 'tok_expiring')).toBe(false);
    expect(await sessions.resolve('malformed')).toBeNull();
    await expect(sessions.issue('malformed', 'tok_x')).rejects.toThrow();
  });
});
