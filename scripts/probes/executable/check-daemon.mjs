import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, readFile, writeFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {setTimeout as sleep} from 'node:timers/promises';

// Acceptance contract: real SEA children, isolated homes, and no external Node/npm on PATH.
const run = promisify(execFile), output = resolve('node_modules/.cache/executable-proof');
const home = await mkdtemp(join(tmpdir(), 'afbin-daemon-proof-'));
const roots = ['main', 'independent', 'launcher-crash', 'port-collision'].map(name => join(home, name));
const binary = join(home, 'afbin-proof');
await copyFile(join(output, 'afbin-proof'), binary);
await mkdir(join(home, 'empty-path'));
const env = {HOME: home, PATH: join(home, 'empty-path'), TMPDIR: home, TMP: home, TEMP: home};
const invoke = async (mode, root = roots[0], ...args) => JSON.parse((await run(binary,
  ['daemon-' + mode, root, ...args.map(String)], {cwd: home, env, timeout: 60000, maxBuffer: 1048576})).stdout);
async function until(action, message) {
  for (let i = 0; i < 400; i++) { if (await action()) return; await sleep(50); }
  throw Error(message);
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
const checks = [], children = [];
let fake, foreignRequests = [];
try {
  const started = await Promise.all(Array.from({length: 5}, () => invoke('ensure')));
  assert.equal(new Set(started.map(state => state.boot)).size, 1);
  assert.equal(new Set(started.map(state => state.pid)).size, 1);
  checks.push('five concurrent launchers produce one live database owner');
  assert.equal((await invoke('status')).boot, started[0].boot);
  assert.equal((await invoke('increment')).value, 1);
  checks.push('daemon survives launcher exit and serves an authenticated durable write');
  const unauthorized = await fetch(started[0].url + '/increment', {method: 'POST'});
  assert.equal(unauthorized.status, 401);
  assert.equal((await invoke('read')).value, 1);
  checks.push('unauthenticated mutation rejected');

  const other = await invoke('ensure', roots[1]);
  assert.notEqual(other.pid, started[0].pid); assert.notEqual(other.url, started[0].url);
  assert.equal((await invoke('read', roots[1])).value, 0);
  checks.push('separate instance directories and ports isolate PGLite data');

  const decoy = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio: 'ignore'});
  children.push(decoy);
  const stateFile = join(roots[0], 'runtime.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  await writeFile(stateFile, JSON.stringify({...state, pid: decoy.pid}));
  await invoke('stop');
  assert.equal(decoy.exitCode, null); process.kill(decoy.pid, 0);
  assert.equal((await invoke('status')).running, false);
  checks.push('stop authenticates the server instead of killing a stale/reused PID');
  const restarted = await invoke('ensure');
  assert.equal(restarted.id, state.id); assert.notEqual(restarted.boot, state.boot);
  assert.equal((await invoke('read')).value, 1);
  checks.push('graceful stop/restart retains identity and committed data');

  // Kill the real database owner with an open transaction; committed data must survive, staged data must not.
  assert.equal((await invoke('uncommitted')).staged, true);
  process.kill(restarted.pid, 'SIGKILL');
  await until(async () => (await invoke('status')).running === false, 'killed daemon still appears ready');
  const recovered = await invoke('ensure');
  assert.equal(recovered.id, state.id); assert.notEqual(recovered.boot, restarted.boot);
  assert.equal((await invoke('read')).value, 1);
  checks.push('SIGKILL releases ownership; restart retains committed data and rolls back an open transaction');

  const launcher = spawn(binary, ['daemon-ensure', roots[2], '0', '1500'], {cwd: home, env, stdio: 'ignore'});
  children.push(launcher);
  await until(() => exists(join(roots[2], 'starting.json')), 'detached child never acquired ownership');
  launcher.kill('SIGKILL');
  const survived = await invoke('ensure', roots[2]);
  assert.equal((await invoke('status', roots[2])).boot, survived.boot);
  assert.equal((await invoke('increment', roots[2])).value, 1);
  const boots = (await readFile(join(roots[2], 'boots.log'), 'utf8')).trim().split('\n');
  assert.equal(boots.length, 1);
  checks.push('launcher death during startup does not orphan or duplicate the detached server');

  await invoke('stop');
  fake = createServer((request, response) => {
    foreignRequests.push({url: request.url, authorization: request.headers.authorization});
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({id: state.id, boot: 'foreign', pid: decoy.pid, proof: 'forged'}));
  });
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  const foreignUrl = `http://127.0.0.1:${fake.address().port}`;
  await writeFile(stateFile, JSON.stringify({...state, url: foreignUrl, pid: decoy.pid}));
  await assert.rejects(invoke('ensure'), error => /identity_mismatch/.test(error.stderr));
  await assert.rejects(invoke('stop'), error => /identity_mismatch/.test(error.stderr));
  assert.ok(foreignRequests.length > 0);
  assert.ok(foreignRequests.every(request => !request.authorization && request.url.startsWith('/identity?')));
  process.kill(decoy.pid, 0);
  await rm(stateFile);
  checks.push('unrelated listener rejected before sending owner credentials or stop requests');
  await assert.rejects(invoke('ensure', roots[3], fake.address().port), error => /EADDRINUSE/.test(error.stderr));
  assert.equal((await invoke('status', roots[3])).running, false);
  checks.push('occupied configured port fails without attaching to the foreign service');

  const evidence = {status: 'passed', platform: process.platform, arch: process.arch, checks,
    scope: 'Actual packaged detached process, SQLite lifetime ownership lock and PGLite; probe routes/authentication, not the complete artifact host or released self commands'};
  await writeFile(join(output, 'daemon-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  fake?.closeAllConnections(); fake?.close();
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  // The probe's authenticated stop is the only cleanup authority; never kill a PID read from a file.
  for (const root of roots) { try { await invoke('stop', root); } catch {} }
  await rm(home, {recursive: true, force: true});
}
