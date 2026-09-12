import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {State, withLock, HOME_SCOPE} from '../src/state';

const fixture = (run: (home: string) => Promise<void>) => async () => {
  const home = await mkdtemp(join(tmpdir(), 'afbin-state-'));
  try { await run(home); } finally { await rm(home, {recursive: true, force: true}); }
};

test('the store lives under the config directory, is private, and keeps nothing in a workspace', fixture(async home => {
  const state = await State.open(home);
  try {
    assert.equal(state.path, join(home, '.artifactbin', 'state.sqlite'));
    assert.equal((await stat(state.path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(home, '.artifactbin'))).mode & 0o777, 0o700);
    assert.equal(state.get('/work', 'tracked', 'doc.jsx'), null);
    assert.deepEqual(state.list('/work', 'tracked'), []);
  } finally { state.close(); }
  assert.deepEqual((await readdir(home)), ['.artifactbin']);
}));

test('records round-trip JSON values and raw bytes per scope and kind', fixture(async home => {
  const state = await State.open(home);
  try {
    state.put('/work', 'tracked', 'doc.jsx', {id: 'abc123', file: 'f'.repeat(64)});
    state.put('/work', 'staged-file', 'doc.jsx', {before: null, sha256: 'a'.repeat(64), mode: 0o600}, {data: Buffer.from([0, 1, 2, 255])});
    state.put('/other', 'tracked', 'doc.jsx', {id: 'zzz999'});
    assert.deepEqual(state.get('/work', 'tracked', 'doc.jsx')?.value, {id: 'abc123', file: 'f'.repeat(64)});
    assert.deepEqual(state.get('/work', 'staged-file', 'doc.jsx')?.data, Buffer.from([0, 1, 2, 255]));
    assert.equal(state.get('/work', 'tracked', 'doc.jsx')?.data, null);
    assert.deepEqual(state.list('/work', 'tracked').map(r => r.key), ['doc.jsx']);
    assert.equal(state.put('/work', 'tracked', 'doc.jsx', {id: 'new'}, {exclusive: true}), false, 'exclusive put never replaces');
    assert.equal(state.get<{id: string}>('/work', 'tracked', 'doc.jsx')?.value.id, 'abc123');
    assert.equal(state.delete('/work', 'tracked', 'doc.jsx'), true);
    assert.equal(state.delete('/work', 'tracked', 'doc.jsx'), false);
    assert.equal(state.clearScope('/other'), 1);
    assert.equal(state.get('/other', 'tracked', 'doc.jsx'), null);
  } finally { state.close(); }
}));

test('a transaction commits all writes or none, and a nested transaction joins the outer one', fixture(async home => {
  const state = await State.open(home);
  try {
    assert.throws(() => state.transaction(() => {
      state.put('/work', 'tracked', 'a.jsx', {id: 'a'});
      state.transaction(() => state.put('/work', 'tracked', 'b.jsx', {id: 'b'}));
      throw new Error('boom');
    }), /boom/);
    assert.deepEqual(state.list('/work', 'tracked'), []);
    state.transaction(() => { state.put('/work', 'tracked', 'a.jsx', {id: 'a'}); state.put('/work', 'tracked', 'b.jsx', {id: 'b'}); });
    assert.deepEqual(state.list('/work', 'tracked').map(r => r.key), ['a.jsx', 'b.jsx']);
  } finally { state.close(); }
}));

test('workspace discovery finds the nearest registered ancestor and nothing else', fixture(async home => {
  const state = await State.open(home);
  try {
    assert.equal(state.nearestWorkspace('/repo/docs/deep'), null);
    state.put('/repo', 'workspace', '/repo', {server: 'https://example.com', account: 'usr_one'});
    state.put('/repo/docs', 'workspace', '/repo/docs', {server: 'https://example.com', account: 'usr_two'});
    assert.deepEqual(state.nearestWorkspace('/repo/docs/deep'), {root: '/repo/docs', value: {server: 'https://example.com', account: 'usr_two'}});
    assert.deepEqual(state.nearestWorkspace('/repo/src')?.root, '/repo');
    assert.equal(state.nearestWorkspace('/elsewhere'), null);
  } finally { state.close(); }
}));

test('two processes see the same store and the busy timeout serialises their writes', fixture(async home => {
  const module = new URL('../src/state.ts', import.meta.url).href;
  const script = `import {State} from ${JSON.stringify(module)}; const s=await State.open(${JSON.stringify(home)}); s.put('/work','conflict','abc123',{path:'doc.jsx',code:'merge_conflict',details:null}); s.close(); process.stdout.write('done');`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {stdio: ['ignore', 'pipe', 'pipe']});
  const [out, err] = await Promise.all([once(child.stdout, 'data').then(x => String(x[0])).catch(() => ''), new Promise<string>(resolve => { let text = ''; child.stderr.on('data', d => { text += d; }); child.on('exit', () => resolve(text)); })]);
  assert.equal(out, 'done', err);
  assert.equal(err, '', 'no experimental warning or other noise reaches stderr');
  const state = await State.open(home);
  try { assert.equal(state.get<{code: string}>('/work', 'conflict', 'abc123')?.value.code, 'merge_conflict'); } finally { state.close(); }
}));

test('a competing process waits for a short holder by default — parallel agent tool calls serialise instead of failing', fixture(async home => {
  const module = new URL('../src/state.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import {withLock} from ${JSON.stringify(module)}; await withLock(${JSON.stringify(home)}, '/work', async()=>{process.stdout.write('locked'); await new Promise(r=>setTimeout(r,600));}); process.stdout.write('released');`], {stdio: ['ignore', 'pipe', 'pipe']});
  try {
    assert.equal(String((await once(child.stdout, 'data'))[0]), 'locked');
    const started = Date.now();
    assert.equal(await withLock(home, '/work', async () => 'entered after the holder finished'), 'entered after the holder finished');
    assert.ok(Date.now() - started >= 300, 'the competitor actually waited for the holder rather than racing it');
    assert.ok(Date.now() - started < 10_000, 'and did not wait anywhere near the full default');
  } finally { child.kill('SIGKILL'); }
}));

test('a lock refuses a competing process, is re-entrant in-process, and the OS releases it after SIGKILL', fixture(async home => {
  const module = new URL('../src/state.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import {withLock} from ${JSON.stringify(module)}; await withLock(${JSON.stringify(home)}, '/work', async()=>{process.stdin.resume(); process.stdout.write('locked'); await new Promise(()=>{});});`], {stdio: ['pipe', 'pipe', 'pipe']});
  try {
    const outcome = await Promise.race([once(child.stdout, 'data').then(x => String(x[0])), once(child, 'exit').then(() => 'exited')]);
    assert.equal(outcome, 'locked');
    await assert.rejects(withLock(home, '/work', async () => assert.fail('competing writer entered'), {waitMs: 0}), /workspace_busy/);
    const started = Date.now();
    await assert.rejects(withLock(home, '/work', async () => assert.fail('competing writer entered'), {waitMs: 250}), /workspace_busy/);
    assert.ok(Date.now() - started >= 200, 'a bounded wait polls the scope before refusing');
    assert.equal(await withLock(home, HOME_SCOPE, async () => 'other scope is independent'), 'other scope is independent');
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    assert.equal(await withLock(home, '/work', () => withLock(home, '/work', async () => 'nested')), 'nested');
    assert.deepEqual((await readdir(join(home, '.artifactbin', 'locks'))).length, 2);
  } finally { child.kill('SIGKILL'); }
}));
