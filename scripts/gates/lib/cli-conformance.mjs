/**
 * THE CLI'S ACCEPTANCE AGAINST A REAL HOST — the one copy of its scenarios: device login through host
 * authentication, the guest connection following its browser into the account, dataset identities kept across
 * registration and publication, owner/non-owner/anonymous private access with a leak negative control, a bound
 * query on the host, the two-workspace conflict and its explicit recovery, and a real Chromium PNG export.
 *
 * Two callers run it: the `cli` leg of scripts/gates/gate-accounts-and-workspace.mjs (the CI shard gate, beside
 * the other account journeys in one browser) and scripts/gate-cli-conformance.mjs, the standalone entry a
 * downstream deployment runs against its composition or the public host with a released executable.
 *
 *   CONFORMANCE__CLI                 the executable under test (default: services/cli/dist/afbin.mjs)
 *   CONFORMANCE__CREDENTIAL_SOURCE   takes the account from the eval's credential helper (scripts/lib/credential.ts)
 *                                    instead of a browser login through the mail sink; `context` is then never called.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { lane } from './lane.mjs';
import { fixtureFetch as fetch } from './fixture-http.mjs';
import { connectAgent } from './cli-connection.mjs';
import { loginViaEmail } from '../../lib/mail-login.mjs';

/**
 * @param {object} host
 * @param {string} host.base       the host's origin
 * @param {Function} host.check    the gate's checker (lib/assert.mjs)
 * @param {string} host.stamp      a run stamp for disposable account names
 * @param {{ inbox: object[], lastCode: Function }} host.sink   the mail sink the host delivers login codes to
 * @param {() => Promise<import('playwright').BrowserContext>} host.context   a fresh browser context, for the login
 */
export async function cliConformance({ base: BASE, check, stamp, sink, context }) {
  // A downstream matrix substitutes the candidate executable without editing scenarios.
  const cli = resolve(process.env.CONFORMANCE__CLI ?? 'services/cli/dist/afbin.mjs');
  const root = await mkdtemp(join(tmpdir(), 'afbin-conformance-'));
  const home = join(root, '.artifactbin');
  const workspace = join(root, 'author');
  await mkdir(workspace);
  // This leg owns consent below. Supply a successful launcher on headless runners;
  // an unavailable OS browser now correctly fails authentication before polling.
  const launcher = join(root, 'browser-launcher');
  await mkdir(launcher);
  for (const command of ['open', 'xdg-open']) await writeFile(join(launcher, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${launcher}:${process.env.PATH ?? ''}`, HOME: root, ARTIFACTBIN_HOME: home, ARTIFACTBIN_URL: BASE, CLI__AUTO_UPDATE: '0' };
  delete env.ARTIFACTBIN_TOKEN;
  delete env.ARTIFACTBIN_REFRESH_TOKEN;
  let guestCookie = '';
  async function invoke(args, { cwd = workspace, expected = 0, approve = false } = {}) {
    const child = spawn(cli.endsWith('.mjs') ? process.execPath : cli,
      [...(cli.endsWith('.mjs') ? [cli] : []), ...args, '--server', BASE, '--yes', '--json'],
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
        const response = await fetch(`${BASE}/oauth/device/approve`, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE },
          body: new URLSearchParams({ user_code: pairing.userCode, decision: 'anonymous' }),
        });
        assert.equal(response.status, 200);
        guestCookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
        assert.ok(guestCookie, 'guest approval establishes the approving browser identity');
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
  /** One acceptance scenario: its asserts are the verdict, and a failure does not stop the next scenario. */
  const scenario = (label, body) => lane(check, 'cli').run(() => lane(check, 'cli').step(label, body));
  // Reuse the eval's real email login for deployments; its outbox variant is exercised in CI.
  const credentialSource = process.env.CONFORMANCE__CREDENTIAL_SOURCE;
  const ctx = credentialSource ? null : await context();
  const publishedIds = [];
  const { step, run } = lane(check, 'cli');
  try {
    await run(async () => {
      await step('CLI device login through host authentication', () => invoke(['auth'], { approve: true }));
      const profile = createHash('sha256').update(BASE).digest('hex').slice(0, 16);
      const saved = await readFile(join(home, 'hosts', profile, 'credentials.env'), 'utf8');
      const token = saved.match(/^ARTIFACTBIN_TOKEN=(.+)$/m)?.[1];
      let accountCookie;
      let id;
      let read;
      await step('guest CLI connection follows its browser into the account', async () => {
        assert.ok(token);
        if (credentialSource) {
          // The eval helper is TypeScript; load it through its existing runner boundary.
          const { acquireCredential } = await tsImport('../../lib/credential.ts', import.meta.url);
          const email = process.env.EVAL_LOGIN_EMAIL ?? `mxmx_test_conformance_${stamp}@example.com`;
          assert.match(email, /^mxmx_test_/, 'acceptance must use a disposable test account');
          const account = await acquireCredential(credentialSource, {
            base: BASE, env: process.env, email, localOutbox: process.env.EMAIL__DEV_OUTBOX_PATH,
          });
          accountCookie = `${guestCookie}; ${account.cookie}`;
        } else {
          const owner = await ctx.newPage();
          await ctx.addCookies(guestCookie.split('; ').map(pair => {
            const separator = pair.indexOf('=');
            return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: BASE, httpOnly: true, sameSite: 'Lax' };
          }));
          await loginViaEmail(owner, BASE, sink, `mxmx_test_conformance_${stamp}@example.com`);
          accountCookie = (await ctx.cookies(BASE)).map(({ name, value }) => `${name}=${value}`).join('; ');
        }
        // A verified browser session merges its guest identity, including the CLI credential.
        // Claiming that credential by bearer secret would try to take another user's token.
        const accountHome = await fetch(`${BASE}/api/page/home?part=core`, { headers: { cookie: accountCookie } });
        assert.equal(accountHome.status, 200);
        assert.equal((await accountHome.json()).signedIn, true);
        await writeFile(join(workspace, 'sales.csv'), 'region,amount\nEU,2\nNA,3\n');
        const registered = await invoke(['add', 'sales.csv']);
        await writeFile(join(workspace, 'report.jsx'), '---\ntitle: mxmx_test_conformance_report\nvisibility: private\n---\n<Helmet><Value name="region" type="string" /><Import name="sales_data" src="ref:' + registered['sales.csv'] + '" /><Query name="sales">{`select sum(amount) total from sales_data.rows where $region is null or region=$region`}</Query></Helmet><h1>Baseline report</h1><Number data="$sales" col="total" />');
        const pushed = await invoke(['push', 'report.jsx']);
        publishedIds.push(...pushed.operations.filter(item => item.id).map(item => item.id));
        const published = pushed.operations.find(item => item.path.endsWith('report.jsx'));
        assert.ok(published?.id, JSON.stringify(pushed));
        id = published.id;
        const library = await fetch(`${BASE}/api/page/home?part=core`, { headers: { cookie: accountCookie } });
        assert.equal(library.status, 200);
        assert.ok((await library.json()).artifacts.some(artifact => artifact.id === id), 'the logged-in account owns the CLI publication after guest merge');
      });
      const api = async (path, credential = token, init = {}) => fetch(`${BASE}${path}`, {
        ...init, headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...init.headers },
      });
      await step('CLI registration and publication preserve dataset identities', async () => {
        read = await api(`/api/artifacts/${id}`);
        assert.equal(read.status, 200);
        assert.match((await read.json()).markup, /<Import name="sales_data" src="ref:/);
      });
      await scenario('owner/non-owner/anonymous private access; leak negative control', async () => {
        const other = (await connectAgent(BASE)).token;
        const hidden = status => assert.equal(status, 404, 'private read must remain hidden');
        assert.equal((await api(`/api/artifacts/${id}`, null)).status, 401, 'API requires authentication');
        hidden((await api(`/a/${id}`, null)).status);
        hidden((await api(`/api/artifacts/${id}`, other)).status);
        // Controlled contract violation: the same assertion must reject a leaked private response.
        assert.throws(() => hidden(read.status), /private read must remain hidden/);
      });
      await scenario('CLI query executes on the host with bound parameters', async () => {
        const query = await invoke(['query', id, '--name', 'sales', '--param', 'region=EU']);
        assert.equal(Number(query.results?.[0]?.rows?.[0]?.total), 2, JSON.stringify(query));
      });
      await scenario('two-workspace conflict preserves draft and explicit recovery works', async () => {
        const second = join(root, 'second');
        await mkdir(second);
        await invoke(['pull', id, '--output', 'copy.jsx'], { cwd: second });
        const original = await readFile(join(workspace, 'report.jsx'), 'utf8');
        await writeFile(join(workspace, 'report.jsx'), original.replace('Baseline report', 'First edit'));
        await invoke(['push', 'report.jsx']);
        const stale = await readFile(join(second, 'copy.jsx'), 'utf8');
        await writeFile(join(second, 'copy.jsx'), stale.replace('Baseline report', 'Conflicting edit'));
        const conflict = await invoke(['push', 'copy.jsx'], { cwd: second, expected: 3 });
        assert.match(JSON.stringify(conflict), /conflict|changed/);
        assert.match(await readFile(join(second, 'copy.jsx'), 'utf8'), /Conflicting edit/);
        await invoke(['pull', 'copy.jsx', '--force'], { cwd: second });
        assert.match(await readFile(join(second, 'copy.jsx'), 'utf8'), /First edit/);
      });
      await scenario('CLI export returns a real Chromium PNG', async () => {
        await invoke(['export', `${BASE}/a/${id}`, '--output', 'report.png']);
        const png = await readFile(join(workspace, 'report.png'));
        assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      });
      check.note(`cli-host-conformance: ${cli}`);
    });
  } finally {
    try { if (publishedIds.length) await invoke(['delete', ...new Set(publishedIds), '--force']); } catch { /* best effort */ }
    await ctx?.close();
    await rm(root, { recursive: true, force: true });
  }
}
