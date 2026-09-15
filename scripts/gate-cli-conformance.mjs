/** Portable CLI/HTTP acceptance against a real host. Mail login gives permission cases real accounts. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';
import { connectAgent } from './lib/cli-connection.mjs';

const base = new URL(process.argv[2]).origin;
// A downstream matrix substitutes the candidate executable without editing scenarios.
const cli = resolve(process.env.CONFORMANCE__CLI ?? 'services/cli/dist/afbin.mjs');
const root = await mkdtemp(join(tmpdir(), 'afbin-conformance-'));
const home = join(root, '.artifactbin');
const workspace = join(root, 'author');
await mkdir(workspace);
const env = { ...process.env, HOME: root, ARTIFACTBIN_HOME: home, ARTIFACTBIN_URL: base, CLI__AUTO_UPDATE: '0' };
delete env.ARTIFACTBIN_TOKEN;
delete env.ARTIFACTBIN_REFRESH_TOKEN;
const evidence = [];
const failures = [];
async function scenario(run) {
  try { await run(); } catch (error) { failures.push(error); console.error(error); }
}
const record = name => { evidence.push(name); console.log(`ok ${name}`); };
async function invoke(args, { cwd = workspace, expected = 0, approve = false } = {}) {
  const child = spawn(cli.endsWith('.mjs') ? process.execPath : cli,
    [...(cli.endsWith('.mjs') ? [cli] : []), ...args, '--server', base, '--yes', '--json'],
    { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', diagnostic = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { diagnostic += chunk; });
  let approved = false;
  let approvalError;
  let checking = false;
  const timer = approve ? setInterval(async () => {
    if (approved || checking) return;
    checking = true;
    try {
      const files = await readdir(home).catch(() => []);
      const file = files.find(name => /^pairing-.*\.json$/.test(name));
      if (!file) return;
      const pairing = JSON.parse(await readFile(join(home, file), 'utf8'));
      const response = await fetch(`${base}/oauth/device/approve`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base },
        body: new URLSearchParams({ user_code: pairing.userCode, decision: 'anonymous' }),
      });
      assert.equal(response.status, 200);
      approved = true;
    } catch (error) { approvalError = error; child.kill(); }
    finally { checking = false; }
  }, 100) : null;
  const deadline = setTimeout(() => child.kill('SIGKILL'), 90_000);
  let code;
  try { code = await new Promise((accept, reject) => { child.on('error', reject); child.on('exit', accept); }); }
  finally { clearTimeout(deadline); if (timer) clearInterval(timer); }
  if (approvalError) throw approvalError;
  assert.equal(code, expected, `${args[0]} exit mismatch: ${output.slice(-1600)} ${diagnostic.slice(-300)}`);
  if (approve) assert.ok(approved, 'CLI requested real device approval');
  return JSON.parse(output.trim());
}
const sink = await startMailSink();
const browser = await chromium.launch();
try {
  await invoke(['auth'], { approve: true });
  record('CLI device login through real proxy');
  const saved = await readFile(join(home, '.env'), 'utf8');
  const token = saved.match(/^ARTIFACTBIN_TOKEN=(.+)$/m)?.[1];
  assert.ok(token);
  const owner = await browser.newPage();
  await loginViaEmail(owner, base, sink, `mxmx_test_conformance_${Date.now().toString(36)}@example.com`);
  assert.equal(await owner.evaluate(async token => (await fetch('/api/tokens/claim', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
  })).status, token), 200);
  const api = async (path, credential = token, init = {}) => fetch(`${base}${path}`, {
    ...init, headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...init.headers },
  });
  await writeFile(join(workspace, 'sales.csv'), 'region,amount\nEU,2\nNA,3\n');
  await writeFile(join(workspace, 'report.jsx'), '---\ntitle: Conformance report\nvisibility: private\n---\n<Helmet><Value name="region" type="string" /><Query name="sales" source="./sales.csv">{`select sum(amount) total from public.rows where $region is null or region=$region`}</Query></Helmet><h1>Baseline report</h1><Number data="$sales" col="total" />');
  const pushed = await invoke(['push', 'report.jsx']);
  const published = pushed.operations.find(item => item.path.endsWith('report.jsx'));
  assert.ok(published?.id, JSON.stringify(pushed));
  const id = published.id;
  const read = await api(`/api/artifacts/${id}`);
  assert.equal(read.status, 200);
  const head = await read.json();
  assert.match(head.markup, /source="ref:/);
  record('CLI publication resolves local dataset references');
  await scenario(async () => {
  const other = (await connectAgent(base)).token;
  const hidden = status => assert.equal(status, 404, 'private read must remain hidden');
  assert.equal((await api(`/api/artifacts/${id}`, null)).status, 401, 'API requires authentication');
  hidden((await api(`/a/${id}`, null)).status);
  hidden((await api(`/api/artifacts/${id}`, other)).status);
  // Controlled contract violation: the same assertion must reject a leaked private response.
  assert.throws(() => hidden(read.status), /private read must remain hidden/);
  record('owner/non-owner/anonymous private access; leak negative control');
  });
  await scenario(async () => {
  const query = await invoke(['query', id, '--name', 'sales', '--param', 'region=EU']);
  assert.equal(Number(query.results?.[0]?.rows?.[0]?.total), 2, JSON.stringify(query));
  record('CLI query executes host DuckDB with bound parameters');
  });
  await scenario(async () => {
  const second = join(root, 'second');
  await mkdir(second);
  await invoke(['pull', id, '--output', 'copy.jsx'], { cwd: second });
  const original = await readFile(join(workspace, 'report.jsx'), 'utf8');
  await writeFile(join(workspace, 'report.jsx'), original.replace('Baseline report', 'First edit'));
  await invoke(['push', 'report.jsx']);
  const stale = await readFile(join(second, 'copy.jsx'), 'utf8');
  await writeFile(join(second, 'copy.jsx'), stale.replace('Baseline report', 'Conflicting edit'));
  const conflict = await invoke(['push', 'copy.jsx'], { cwd: second, expected: 2 });
  assert.match(JSON.stringify(conflict), /conflict|changed/);
  assert.match(await readFile(join(second, 'copy.jsx'), 'utf8'), /Conflicting edit/);
  await invoke(['pull', 'copy.jsx', '--force'], { cwd: second });
  assert.match(await readFile(join(second, 'copy.jsx'), 'utf8'), /First edit/);
  record('two-workspace conflict preserves draft and explicit recovery works');
  });
  await scenario(async () => {
  await invoke(['export', id, '--output', 'report.png']);
  const png = await readFile(join(workspace, 'report.png'));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  record('CLI export returns a real Chromium PNG');
  });
  if (failures.length) throw new AggregateError(failures, 'CLI host conformance failed');
  console.log(JSON.stringify({ suite: 'cli-host-conformance', checks: evidence, cli, base }));
} finally {
  sink.close();
  await browser.close();
  await rm(root, { recursive: true, force: true });
}
