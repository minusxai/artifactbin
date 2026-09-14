import { expect, it, vi } from 'vitest';
import { createBrowserSessions } from '../src/sessions';

it('persists execution IDs before waiting, serializes scripts, and refuses cross-owner access and replay', async () => {
  const release: Array<() => void> = [];
  const run = vi.fn(async (code: string) => { await new Promise<void>(resolve => release.push(resolve)); return { result: code, pages: [], attachments: [] }; });
  const close = vi.fn(async () => {});
  const sessions = createBrowserSessions(async () => ({ run, close }));
  const actor = { credential: 'bearer' as const, tokenId: 'owner' };
  const first = { actor, op: 'script' as const, session_id: 'one', execution_id: 'first', create: true, code: 'return 1' };
  try {
    expect((await sessions.request(first)).status).toBe('queued');
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect((await sessions.request(first)).status).toBe('running');
    expect((await sessions.request({ ...first, code: 'return 2' })).error?.code).toBe('EXECUTION_CONFLICT');
    expect((await sessions.request({ ...first, actor: { ...actor, tokenId: 'stranger' } })).error?.code).toBe('SESSION_NOT_FOUND');
    await sessions.request({ ...first, execution_id: 'second', code: 'return 2' });
    expect(run).toHaveBeenCalledTimes(1);
    release.shift()!();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    release.shift()!();
    await vi.waitFor(async () => expect((await sessions.request({ actor, op: 'status', session_id: 'one', execution_id: 'second' })).result).toBe('return 2'));
    await sessions.request({ actor, op: 'close', session_id: 'one' });
    expect(close).toHaveBeenCalledOnce();
    expect((await sessions.request({ ...first, execution_id: 'third' })).error?.code).toBe('SESSION_LOST');
  } finally { await sessions.close(); }
});
