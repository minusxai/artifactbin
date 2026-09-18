/**
 * TEST USERS FROM THE COMMAND LINE — minting the other person, giving that person a copy of the
 * page, and erasing everything they did in one call.
 *
 * A test user is a throwaway person an account mints to verify an app with two people. It is a
 * full user toward what test users own and exactly a guest toward everything else, so the one
 * door from the real world into the sandbox is `afbin fork <ref> --as <testuser>`: the COPY is
 * the test user's, the original is never touched. `--as` names that person; it never names a
 * kind, and a session never mints one.
 *
 * Everything here runs against the recording harness — no server, no browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cliHarness, type RecordedCall } from './harness';
import { parseCommand } from '../src/commands';
import { diagnosticCatalog } from '../src/diagnostics';

const TU = 'tu_9fA2b';
const OTHER = 'tu_x7Qz1';
const user = (id: string, extra: Record<string, unknown> = {}) => ({
  id, label: `Test user ${id.slice(3, 7)}`,
  created_at: '2026-09-18T10:00:00.000Z', expires_at: '2026-09-19T10:00:00.000Z',
  artifacts: 0, sessions: 0, ...extra,
});
/** A refusal the way the server answers it: the code is the body's `error`. */
const refuse = (code: string, status: number, body: Record<string, unknown> = {}) =>
  Response.json({ error: code, ...body }, { status });

test('testuser new mints one person and prints its id, label and expiry', async () => {
  const h = await cliHarness('afbin-testuser-new-');
  try {
    const code = await h.invoke(['testuser', 'new', '--json'], call => {
      assert.equal(call.method, 'POST');
      assert.equal(call.path, '/api/testusers');
      return Response.json(user(TU), { status: 201 });
    });
    assert.equal(code, 0, JSON.stringify(h.last()));
    const made = h.last();
    assert.equal(made.id, TU);
    assert.equal(made.label, 'Test user 9fA2');
    assert.equal(made.expires_at, '2026-09-19T10:00:00.000Z');
    assert.equal(h.calls.length, 1);
  } finally { await h.cleanup(); }
});

test('testuser list prints each live test user with what it owns', async () => {
  const h = await cliHarness('afbin-testuser-list-');
  try {
    const code = await h.invoke(['testuser', 'list', '--json'], call => {
      assert.equal(call.method, 'GET');
      assert.equal(call.pathname, '/api/testusers');
      return Response.json({ testusers: [user(TU, { artifacts: 2, sessions: 1 }), user(OTHER)] });
    });
    assert.equal(code, 0, JSON.stringify(h.last()));
    const { testusers } = h.last();
    assert.deepEqual(testusers.map((t: { id: string }) => t.id), [TU, OTHER]);
    assert.equal(testusers[0].artifacts, 2);
    assert.equal(testusers[0].sessions, 1);
  } finally { await h.cleanup(); }
});

test('testuser delete erases one person and says what went with it', async () => {
  const h = await cliHarness('afbin-testuser-delete-');
  try {
    const code = await h.invoke(['testuser', 'delete', TU, '--json'], call => {
      if (call.method === 'GET') return Response.json({ testusers: [user(TU, { artifacts: 3, sessions: 2 }), user(OTHER)] });
      assert.equal(call.method, 'DELETE');
      assert.equal(call.path, `/api/testusers/${TU}`);
      return Response.json({ deleted: true });
    });
    assert.equal(code, 0, JSON.stringify(h.last()));
    const result = h.last();
    assert.deepEqual(result.operations, [{ id: TU, label: 'Test user 9fA2', artifacts: 3, sessions: 2, status: 'deleted' }]);
    assert.deepEqual(result.erased, { artifacts: 3, sessions: 2 });
    // Only the named one; the other test user is untouched.
    assert.deepEqual(h.calls.filter(c => c.method === 'DELETE').map(c => c.path), [`/api/testusers/${TU}`]);
  } finally { await h.cleanup(); }
});

test('testuser delete --all erases every test user this account holds, one call each', async () => {
  const h = await cliHarness('afbin-testuser-delete-all-');
  try {
    const code = await h.invoke(['testuser', 'delete', '--all', '--json'], call => {
      if (call.method === 'GET') return Response.json({ testusers: [user(TU, { artifacts: 1, sessions: 1 }), user(OTHER, { artifacts: 4, sessions: 0 })] });
      return Response.json({ deleted: true });
    });
    assert.equal(code, 0, JSON.stringify(h.last()));
    assert.deepEqual(h.calls.filter(c => c.method === 'DELETE').map(c => c.path), [`/api/testusers/${TU}`, `/api/testusers/${OTHER}`]);
    assert.deepEqual(h.last().erased, { artifacts: 5, sessions: 1 });
    assert.deepEqual(h.last().operations.map((o: { id: string; status: string }) => [o.id, o.status]), [[TU, 'deleted'], [OTHER, 'deleted']]);
  } finally { await h.cleanup(); }
});

test('testuser delete --all with nothing to erase makes no delete request', async () => {
  const h = await cliHarness('afbin-testuser-delete-none-');
  try {
    const code = await h.invoke(['testuser', 'delete', '--all', '--json'], () => Response.json({ testusers: [] }));
    assert.equal(code, 0, JSON.stringify(h.last()));
    assert.deepEqual(h.last().operations, []);
    assert.deepEqual(h.last().erased, { artifacts: 0, sessions: 0 });
    assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 0);
  } finally { await h.cleanup(); }
});

test('testuser arguments are checked locally: an operation, one target, --all only on delete', () => {
  assert.deepEqual(parseCommand(['testuser', 'new']).positionals, ['new']);
  assert.equal(parseCommand(['testuser', 'delete', '--all']).flags.all, true);
  for (const args of [
    ['testuser'], ['testuser', 'nope'], ['testuser', 'new', TU], ['testuser', 'list', TU],
    ['testuser', 'delete'], ['testuser', 'delete', TU, '--all'], ['testuser', 'new', '--all'],
    ['testuser', 'list', '--all'], ['push', 'a.jsx', '--all'], ['testuser', 'delete', TU, OTHER],
  ]) assert.throws(() => parseCommand(args), Error, args.join(' '));
});

/**
 * EVERY REFUSAL KEEPS THE SERVER'S CODE AND GAINS THE FIX. An agent that meets `testuser_limit`
 * with no way out mints nothing and verifies nothing.
 */
test('each test-user refusal arrives with its own code and a fix naming an afbin command', async () => {
  const cases: Array<[string[], string, number, RegExp]> = [
    [['testuser', 'new'], 'testuser_limit', 409, /afbin testuser delete <id>/],
    [['testuser', 'new'], 'testuser_requires_account', 403, /afbin auth/],
    [['testuser', 'delete', OTHER], 'not_your_testuser', 403, /afbin testuser list/],
  ];
  for (const [args, code, status, fix] of cases) {
    const h = await cliHarness('afbin-testuser-refusal-');
    try {
      const exit = await h.invoke([...args, '--json'], call =>
        call.method === 'GET' && call.pathname === '/api/testusers' ? Response.json({ testusers: [] }) : refuse(code, status));
      assert.notEqual(exit, 0, code);
      assert.equal(h.last().error.code, code);
      assert.match(String(h.last().error.fix), fix);
    } finally { await h.cleanup(); }
  }
});

test('the catalogue explains the sandbox refusals a test user meets in the browser too', () => {
  for (const code of ['testuser_limit', 'testuser_expired', 'not_your_testuser', 'testuser_requires_account', 'sandbox_only', 'sign_in_required']) {
    const entry = diagnosticCatalog[code];
    assert.ok(entry, `${code} has no diagnostic entry`);
    assert.ok(entry!.meaning.length > 20 && entry!.fix.length > 20, code);
    assert.match(entry!.fix, /afbin /, `${code} fix names no afbin command`);
  }
  // The refusal an agent gets for pressing Join on somebody else's real page has to name the door.
  assert.match(diagnosticCatalog['sandbox_only']!.fix, /afbin fork <id> --as <testuser>/);
  assert.match(diagnosticCatalog['testuser_limit']!.fix, /afbin testuser delete <id>/);
  assert.match(diagnosticCatalog['testuser_expired']!.fix, /afbin testuser new/);
  // A guest meeting a $_me write has two ways on: sign in, or be the other person on a copy.
  assert.match(diagnosticCatalog['sign_in_required']!.fix, /afbin testuser new/);
});

test('fork --as gives the copy to a test user, through the one server door', async () => {
  const h = await cliHarness('afbin-fork-as-testuser-');
  try {
    const code = await h.invoke(['fork', 'abc123', '--as', TU, '--json'], call => {
      assert.equal(call.method, 'POST');
      assert.equal(call.path, '/api/artifacts/abc123/fork');
      assert.deepEqual(call.body, { as: { testuser: TU } });
      return Response.json({ id: 'cpy456', url: 'https://example.com/a/cpy456', visibility: 'private', datasets: [{ id: 'ds789', forked_from: 'ds111' }] });
    });
    assert.equal(code, 0, JSON.stringify(h.last()));
    const [operation] = h.last().operations;
    assert.equal(operation.id, 'cpy456');
    assert.equal(operation.forked_from, 'abc123');
    assert.deepEqual(operation.owner, { testuser: TU });
    assert.equal(operation.status, 'created');
    // The copy belongs to a person this workspace will erase: nothing is pulled or tracked here.
    assert.equal('path' in operation, false);
    assert.equal(h.calls.filter(c => c.method !== 'GET' || c.pathname !== '/api/server').length, 1);
  } finally { await h.cleanup(); }
});

test('fork --as keeps the id spelled exactly as it was minted', async () => {
  const h = await cliHarness('afbin-fork-as-case-');
  try {
    await h.invoke(['fork', 'abc123', '--as', 'tu_MiXeD', '--json'], call => {
      assert.deepEqual(call.body, { as: { testuser: 'tu_MiXeD' } });
      return Response.json({ id: 'cpy456' });
    });
    assert.equal(h.last().operations[0].id, 'cpy456');
  } finally { await h.cleanup(); }
});

test('fork --as guest is refused before any request: a guest owns nothing', async () => {
  const h = await cliHarness('afbin-fork-as-guest-');
  try {
    const code = await h.invoke(['fork', 'abc123', '--as', 'guest', '--json'], () => assert.fail('refused locally'));
    assert.notEqual(code, 0);
    assert.equal(h.network(), 0, 'refused before any request');
    assert.match(String(h.last().error.message + h.last().error.fix), /test user/i);
  } finally { await h.cleanup(); }
});

test('a session browses as a guest, as a named test user, or as you', async () => {
  const h = await cliHarness('afbin-session-as-');
  try {
    await writeFile(join(h.root, 'actions.js'), 'const page=await context.newPage(); return page.url();');
    const done = (call: RecordedCall) => Response.json({
      session_id: String((call.body as Record<string, unknown>).session_id),
      execution_id: String((call.body as Record<string, unknown>).execution_id ?? 'e'),
      status: 'completed', result: 1, pages: [], attachments: [],
    });
    const sent = () => h.calls.map(call => call.body as Record<string, unknown>).find(body => body.op === 'script')!;

    assert.equal(await h.invoke(['sessions', 'script', 'new', '--as', TU, '--input', 'actions.js', '--json'], done), 0, JSON.stringify(h.last()));
    assert.deepEqual(sent().viewer, { testuser: TU });
    assert.equal(sent().create, true);

    h.calls.length = 0;
    assert.equal(await h.invoke(['sessions', 'script', 'new', '--as', 'guest', '--input', 'actions.js', '--json'], done), 0);
    assert.equal(sent().viewer, 'guest');

    // Without --as the request names no viewer at all: the session browses as its owner.
    h.calls.length = 0;
    assert.equal(await h.invoke(['sessions', 'script', 'new', '--input', 'actions.js', '--json'], done), 0);
    assert.equal('viewer' in sent(), false);

    // Nothing the CLI sends carries the retired kind spelling.
    for (const call of h.calls) assert.doesNotMatch(JSON.stringify(call.body ?? null), /test-user/);
  } finally { await h.cleanup(); }
});

test('--as on an existing session is refused locally: its viewer was chosen when it was created', async () => {
  const h = await cliHarness('afbin-session-as-resume-');
  try {
    await writeFile(join(h.root, 'actions.js'), 'const page=await context.newPage(); return page.url();');
    const code = await h.invoke(['sessions', 'script', 'session_id', '--as', TU, '--input', 'actions.js', '--json'], () => assert.fail('refused locally'));
    assert.notEqual(code, 0);
    assert.equal(h.network(), 0, 'refused before any request');
    assert.match(String(h.last().error.message), /fixed|created/i);
  } finally { await h.cleanup(); }
});

/**
 * `--as testuser` IS THE MISTAKE THIS REPLACES. The flag used to take a kind, and a fresh person
 * was minted per session; now it takes the id of a person you minted and can list, reuse and erase.
 */
test('--as names a person, never a kind, and the refusal says where an id comes from', () => {
  for (const spelling of ['testuser', 'test-user', 'TestUser', 'TEST-USER']) {
    for (const args of [['fork', 'abc123', '--as', spelling], ['sessions', 'script', 'new', '--as', spelling, '--input', 'a.js']]) {
      assert.throws(() => parseCommand(args), (error: unknown) => {
        const e = error as { code: string; message: string; fix?: string };
        assert.equal(e.code, 'invalid_viewer', args.join(' '));
        assert.match(`${e.message} ${e.fix ?? ''}`, /afbin testuser new/);
        return true;
      }, args.join(' '));
    }
  }
  assert.equal(parseCommand(['sessions', 'script', 'new', '--as', 'GUEST', '--input', 'a.js']).flags.as, 'guest');
  assert.equal(parseCommand(['fork', 'abc123', '--as', 'tu_MiXeD']).flags.as, 'tu_MiXeD');
  for (const args of [
    ['sessions', 'status', 'abc', '--as', 'guest'], ['sessions', 'close', 'abc', '--as', TU],
    ['push', 'a.jsx', '--as', 'guest'], ['pull', 'abc123', '--as', TU],
    ['fork', 'abc123', '--as', 'guest'], ['fork', 'abc123', '--as', 'tu bad id'],
    ['fork', 'abc123', '--as', TU, '--output', 'copy.jsx'],
  ]) assert.throws(() => parseCommand(args), Error, args.join(' '));
});

test('the CLI never sends the retired test-user spelling on any surface', async () => {
  const h = await cliHarness('afbin-testuser-spelling-');
  try {
    await writeFile(join(h.root, 'actions.js'), 'return 1;');
    await h.invoke(['testuser', 'new', '--json'], () => Response.json(user(TU), { status: 201 }));
    await h.invoke(['fork', 'abc123', '--as', TU, '--json'], () => Response.json({ id: 'cpy456' }));
    await h.invoke(['sessions', 'script', 'new', '--as', TU, '--input', 'actions.js', '--json'], call => Response.json({
      session_id: String((call.body as Record<string, unknown>).session_id), execution_id: 'e', status: 'completed', result: 1, pages: [], attachments: [],
    }));
    assert.ok(h.calls.length >= 3);
    for (const call of h.calls) assert.doesNotMatch(`${call.path} ${JSON.stringify(call.body ?? null)}`, /test-user/);
  } finally { await h.cleanup(); }
});
