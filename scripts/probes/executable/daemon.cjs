// Planning probe only. Argv is the configuration boundary; credentials never travel in argv or URLs.
const fs = require('node:fs/promises');
const {join} = require('node:path');
const {createServer} = require('node:http');
const {spawn} = require('node:child_process');
const {randomUUID, randomBytes, createHmac, timingSafeEqual} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {setTimeout: sleep} = require('node:timers/promises');

async function read(path) { try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function write(path, value) {
  const temp = path + '.' + randomUUID();
  await fs.writeFile(temp, JSON.stringify(value), {mode: 0o600}); await fs.rename(temp, path);
}
function equal(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function signature(profile, challenge, state) {
  return createHmac('sha256', profile.token).update(JSON.stringify([challenge, state.id, state.boot, state.pid])).digest('hex');
}
async function lock(path, wait = 30000) {
  const db = new DatabaseSync(path); await fs.chmod(path, 0o600);
  const deadline = Date.now() + wait;
  for (;;) {
    try { db.exec('BEGIN EXCLUSIVE'); return () => { db.exec('ROLLBACK'); db.close(); }; }
    catch (e) {
      if (e.errcode !== 5 || Date.now() >= deadline) { db.close(); throw e; }
      await sleep(25);
    }
  }
}
async function available(path) {
  try { const release = await lock(path, 0); release(); return true; }
  catch (e) { if (e.errcode === 5) return false; throw e; }
}
async function identify(root, profile) {
  const state = await read(join(root, 'runtime.json'));
  if (!state) return null;
  const target = new URL(state.url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') throw Error('identity_mismatch');
  const challenge = randomBytes(24).toString('hex');
  let response;
  try { response = await fetch(state.url + '/identity?challenge=' + challenge, {signal: AbortSignal.timeout(1000), redirect: 'error'}); }
  catch { return null; }
  let actual;
  try { actual = await response.json(); } catch { throw Error('identity_mismatch'); }
  if (!response.ok || actual.id !== profile.id || actual.boot !== state.boot || typeof actual.proof !== 'string'
    || !equal(actual.proof, signature(profile, challenge, actual))) throw Error('identity_mismatch');
  return {...actual, url: state.url};
}
async function request(root, profile, path) {
  const actual = await identify(root, profile);
  if (!actual) throw Error('server_not_running');
  const response = await fetch(actual.url + path, {method: 'POST', headers: {authorization: 'Bearer ' + profile.token},
    signal: AbortSignal.timeout(10000), redirect: 'error'});
  if (!response.ok) throw Error('server_request_failed: ' + response.status);
  return response.json();
}
async function ensure(root, profile, port, delay) {
  const current = await identify(root, profile);
  if (current) return current;
  if (await available(join(root, 'owner.sqlite'))) {
    await fs.rm(join(root, 'error.json'), {force: true});
    const child = spawn(process.execPath, ['daemon-serve', root, String(port), String(delay)], {detached: true, stdio: 'ignore'});
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  }
  for (let i = 0; i < 600; i++) {
    const current = await identify(root, profile);
    if (current) return current;
    const failure = await read(join(root, 'error.json'));
    if (failure) throw Error(failure.code);
    await sleep(50);
  }
  throw Error('startup_timeout');
}
async function serve(root, profile, port, delay, getPGlite) {
  // Acquire lifetime ownership before opening PGLite. Never remove this lock file while it can be held.
  const release = await lock(join(root, 'owner.sqlite'), 0);
  const boot = randomUUID();
  let db, server, stopping = false;
  async function close() {
    if (stopping) return; stopping = true;
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    await db?.close();
    const current = await read(join(root, 'runtime.json'));
    if (current?.boot === boot) await fs.rm(join(root, 'runtime.json'), {force: true});
    await fs.rm(join(root, 'starting.json'), {force: true}); release();
  }
  try {
    await write(join(root, 'starting.json'), {boot});
    await fs.appendFile(join(root, 'boots.log'), boot + '\n', {mode: 0o600});
    const PGlite = await getPGlite(); db = new PGlite(join(root, 'server-data'));
    await db.exec('create table if not exists counter (id integer primary key, value integer); insert into counter values (1, 0) on conflict do nothing');
    await sleep(delay);
    let state;
    server = createServer(async (req, res) => {
      const json = (code, value) => { res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(value)); };
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/identity') {
        const challenge = url.searchParams.get('challenge') ?? '';
        if (!/^[a-f0-9]{48}$/.test(challenge)) return json(400, {});
        return json(200, {...state, proof: signature(profile, challenge, state)});
      }
      if (req.method !== 'POST' || !equal(req.headers.authorization ?? '', 'Bearer ' + profile.token)) return json(401, {});
      try {
        if (url.pathname === '/stop') { json(200, {stopping: true}); setImmediate(() => { close().then(() => process.exit(0)).catch(() => process.exit(1)); }); return; }
        if (url.pathname === '/uncommitted') {
          await db.exec('BEGIN; UPDATE counter SET value = value + 100 WHERE id = 1'); return json(200, {staged: true});
        }
        if (url.pathname === '/increment') await db.exec('UPDATE counter SET value = value + 1 WHERE id = 1');
        else if (url.pathname !== '/read') return json(404, {});
        json(200, (await db.query('SELECT value FROM counter WHERE id = 1')).rows[0]);
      } catch { json(500, {error: 'database_request_failed'}); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    state = {id: profile.id, boot, pid: process.pid, url: 'http://127.0.0.1:' + server.address().port};
    await write(join(root, 'runtime.json'), state);
    await fs.rm(join(root, 'starting.json'), {force: true});
    process.on('SIGTERM', () => { close().then(() => process.exit(0)).catch(() => process.exit(1)); });
    await new Promise(() => {});
  } catch (e) {
    await write(join(root, 'error.json'), {code: e.code ?? 'startup_failed'}); await close(); throw e;
  }
}
exports.run = async function ({mode, root, getPGlite}) {
  const port = Number(process.argv[4] ?? 0), delay = Number(process.argv[5] ?? 0);
  if (mode === 'daemon-serve') {
    const profile = await read(join(root, 'profile.json'));
    if (!profile) throw Error('missing_profile');
    return serve(root, profile, port, delay, getPGlite);
  }
  const release = await lock(join(root, 'startup.sqlite'));
  try {
    let profile = await read(join(root, 'profile.json'));
    if (!profile && ['daemon-status', 'daemon-stop'].includes(mode)) { console.log(JSON.stringify({running: false})); return; }
    if (!profile) {
      profile = {id: randomUUID(), token: randomBytes(32).toString('hex')};
      await write(join(root, 'profile.json'), profile);
    }
    if (mode === 'daemon-status') { console.log(JSON.stringify(await identify(root, profile) ?? {running: false})); return; }
    if (mode === 'daemon-stop') {
      const current = await identify(root, profile);
      if (current) await request(root, profile, '/stop');
      for (let i = 0; i < 600; i++) {
        if (await available(join(root, 'owner.sqlite'))) { console.log(JSON.stringify({running: false})); return; }
        await sleep(50);
      }
      throw Error('shutdown_timeout');
    }
    const current = await ensure(root, profile, port, delay);
    console.log(JSON.stringify(mode === 'daemon-ensure' ? current : await request(root, profile, '/' + mode.slice(7))));
  } finally { release(); }
};
