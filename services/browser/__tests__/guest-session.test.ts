/**
 * A session browses as its creator, so an agent could never see what a signed-out
 * reader sees. `viewer: 'guest'` on the creating request makes the PAGES anonymous;
 * the session itself still belongs to whoever created it.
 */
import { expect, it, vi } from 'vitest';
import { ANONYMOUS, type Actor } from '@artifactbin/contracts';
import { createBrowserSessions } from '../src/sessions';

const owner = { credential: 'bearer' as const, tokenId: 'owner', userId: 'usr_owner' };
const worker = () => ({ run: vi.fn(async () => ({ result: 'ok', pages: [], attachments: [] })), close: vi.fn(async () => {}) });

it('hands the worker the anonymous actor for a guest session, and the creator otherwise', async () => {
  const seen: Actor[] = [];
  const sessions = createBrowserSessions(async (actor) => { seen.push(actor); return worker(); });
  try {
    await sessions.request({ actor: owner, op: 'script', session_id: 'guest', execution_id: 'e1', create: true, code: 'return 1', viewer: 'guest' });
    await sessions.request({ actor: owner, op: 'script', session_id: 'self', execution_id: 'e1', create: true, code: 'return 1' });
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[0]).toEqual(ANONYMOUS);
    expect(seen[1]).toMatchObject({ userId: 'usr_owner' });
  } finally { await sessions.close(); }
});

it('keeps a guest session owned by its creator', async () => {
  const sessions = createBrowserSessions(async () => worker());
  try {
    await sessions.request({ actor: owner, op: 'script', session_id: 'guest', execution_id: 'e1', create: true, code: 'return 1', viewer: 'guest' });
    expect((await sessions.request({ actor: { credential: 'bearer', tokenId: 'stranger' }, op: 'status', session_id: 'guest' })).error?.code).toBe('SESSION_NOT_FOUND');
    expect((await sessions.request({ actor: { credential: 'none' }, op: 'status', session_id: 'guest' })).error?.code).toBeDefined();
    expect((await sessions.request({ actor: owner, op: 'status', session_id: 'guest' })).error).toBeUndefined();
  } finally { await sessions.close(); }
});

it('never changes who an existing session browses as', async () => {
  const seen: Actor[] = [];
  const sessions = createBrowserSessions(async (actor) => { seen.push(actor); return worker(); });
  try {
    await sessions.request({ actor: owner, op: 'script', session_id: 'self', execution_id: 'e1', create: true, code: 'return 1' });
    const later = await sessions.request({ actor: owner, op: 'script', session_id: 'self', execution_id: 'e2', create: false, code: 'return 2', viewer: 'guest' });
    expect(later.error?.code).toBeDefined();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ userId: 'usr_owner' });
  } finally { await sessions.close(); }
});
