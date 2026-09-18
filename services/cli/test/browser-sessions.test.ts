import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cliHarness, type RecordedCall } from './harness';
import { parseCommand } from '../src/commands';

test('sessions submits once, polls the same receipt, and preserves returned page IDs and images', async () => {
  const h = await cliHarness('afbin-browser-session-');
  try {
    await writeFile(join(h.root, 'actions.js'), 'const page=await context.newPage(); return page.url();');
    let ids: { session_id: string; execution_id: string } | undefined;
    const code = await h.invoke(['sessions', 'script', 'new', '--input', 'actions.js', '--json'], call => {
      assert.equal(call.path, '/api/browser-sessions');
      const body = call.body as Record<string, unknown>;
      if (body.op === 'script') {
        assert.equal(body.create, true);
        ids = { session_id: String(body.session_id), execution_id: String(body.execution_id) };
        return Response.json({ ...ids, status: 'queued', pages: [], attachments: [] });
      }
      assert.equal(body.op, 'status');
      assert.equal(body.execution_id, ids!.execution_id);
      return Response.json({ ...ids, status: 'completed', result: 42, pages: [{page_id:'page-one',url:'about:blank'}], attachments: [{mime:'image/png',base64:'image'}] });
    });
    assert.equal(code, 0, JSON.stringify(h.last()));
    assert.equal(h.last().result, 42);
    assert.equal(h.last().pages[0].page_id, 'page-one');
    assert.equal(h.calls.filter(call => (call.body as {op?:string})?.op === 'script').length, 1);
  } finally { await h.cleanup(); }
});

test('--as guest creates a session that browses signed out; a session viewer is fixed at creation', async () => {
  const h = await cliHarness('afbin-guest-session-');
  try {
    await writeFile(join(h.root, 'actions.js'), 'const page=await context.newPage(); return page.url();');
    const done = (call: RecordedCall) => Response.json({ session_id: String((call.body as Record<string, unknown>).session_id), execution_id: String((call.body as Record<string, unknown>).execution_id ?? 'e'), status: 'completed', result: 1, pages: [], attachments: [] });

    const guest = await h.invoke(['sessions', 'script', 'new', '--as', 'guest', '--input', 'actions.js', '--json'], done);
    assert.equal(guest, 0, JSON.stringify(h.last()));
    const created = h.calls.map(call => call.body as Record<string, unknown>).find(body => body.op === 'script')!;
    assert.equal(created.viewer, 'guest');
    assert.equal(created.create, true);

    // Without --as, the request names no viewer at all: the session browses as its owner.
    h.calls.length = 0;
    assert.equal(await h.invoke(['sessions', 'script', 'new', '--input', 'actions.js', '--json'], done), 0);
    const plain = h.calls.map(call => call.body as Record<string, unknown>).find(body => body.op === 'script')!;
    assert.equal('viewer' in plain, false);

    // An existing session is refused locally: its viewer was decided when it was created.
    h.calls.length = 0;
    const attempted = h.network();
    const resumed = await h.invoke(['sessions', 'script', 'session_id', '--as', 'guest', '--input', 'actions.js', '--json'], done);
    assert.notEqual(resumed, 0);
    assert.equal(h.network(), attempted, 'refused before any request');
    assert.match(String(h.last().error.message), /fixed|created/i);
  } finally { await h.cleanup(); }
});

/**
 * The SECOND person is a NAMED one. `--as guest` shows what a signed-out reader sees; being
 * somebody else on a page needs a test user this account minted and can reuse, list and erase —
 * `--as <testuser-id>`, exercised in testuser.test.ts. A session never mints a person of its own,
 * so the only fixed name `--as` still accepts here is `guest`.
 */
test('--as names a viewer afbin can browse as, only where it can be chosen', () => {
  assert.equal(parseCommand(['sessions', 'script', 'new', '--as', 'GUEST', '--input', 'a.js']).flags.as, 'guest');
  assert.equal(parseCommand(['sessions', 'script', 'new', '--as', 'tu_9fA2b', '--input', 'a.js']).flags.as, 'tu_9fA2b');
  for (const args of [['sessions', 'script', 'new', '--as', 'test-user', '--input', 'a.js'], ['sessions', 'script', 'new', '--as', 'testuser', '--input', 'a.js'], ['sessions', 'status', 'abc', '--as', 'guest'], ['sessions', 'close', 'abc', '--as', 'tu_9fA2b'], ['push', 'a.jsx', '--as', 'guest']]) {
    assert.throws(() => parseCommand(args), Error, args.join(' '));
  }
});
