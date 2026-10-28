/**
 * THE CLI'S ACCEPTANCE AGAINST A REAL HOST — the one copy of its scenarios: device login through host
 * authentication, the guest connection following its browser into the account, dataset identities kept across
 * registration and publication, owner/non-owner/anonymous private access with a leak negative control, a bound
 * query on the host, the two-workspace conflict and its explicit recovery, and a real Chromium PNG export.
 *
 * One caller runs it: scripts/gate-cli-conformance.mjs, the standalone entry the server repository's CI runs
 * against its composition with a released executable.
 *
 *   CONFORMANCE__CLI                 the executable under test (required: this repository builds no CLI)
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
import { connectAgent, connectionBrowserCookie, signInAccount } from './account-connection.mjs';
import { connectConformanceNonOwner } from '../../lib/conformance-account.mjs';
import { checkGuestHttpIssuance, checkDirectHttp } from './http-conformance.mjs';
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
  if (!process.env.CONFORMANCE__CLI) throw new Error('Set CONFORMANCE__CLI to the released afbin executable under test.');
  const cli = resolve(process.env.CONFORMANCE__CLI);
  const root = await mkdtemp(join(tmpdir(), 'afbin-conformance-'));
  const home = join(root, '.artifactbin');
  const workspace = join(root, 'author');
  await mkdir(workspace);
  // This leg owns consent below. Supply a successful launcher on headless runners;
  // an unavailable OS browser now correctly fails authentication before polling.
  const launcher = join(root, 'browser-launcher');
  await mkdir(launcher);
  // It records what the CLI opened, so this leg can play the signed-in browser for a loopback sign-in.
  const openedLog = join(root, 'opened.log');
  for (const command of ['open', 'xdg-open']) await writeFile(join(launcher, command), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${openedLog}'\nexit 0\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${launcher}:${process.env.PATH ?? ''}`, HOME: root, ARTIFACTBIN_HOME: home, ARTIFACTBIN_URL: BASE, CLI__AUTO_UPDATE: '0' };
  delete env.ARTIFACTBIN_TOKEN;
  delete env.ARTIFACTBIN_REFRESH_TOKEN;
  const accountEmail = process.env.EVAL_LOGIN_EMAIL ?? `mxmx_test_conformance_${stamp}@example.com`;
  // Deployment acceptance reads its configured inbox; local gates read their protected outbox.
  const credentialSource = process.env.CONFORMANCE__CREDENTIAL_SOURCE;
  const approvingAccount = credentialSource
    ? await (await tsImport('../../lib/credential.ts', import.meta.url)).acquireCredential(credentialSource, {
      base: BASE, env: process.env, email: accountEmail, localOutbox: process.env.EMAIL__DEV_OUTBOX_PATH,
    })
    : await signInAccount(BASE, { sink, email: accountEmail });
  let browserCookie = approvingAccount.cookie;
  async function invoke(args, { cwd = workspace, expected = 0, approve = false, credential } = {}) {
    const child = spawn(cli.endsWith('.mjs') ? process.execPath : cli,
      [...(cli.endsWith('.mjs') ? [cli] : []), ...args, '--server', BASE, '--yes', '--json'],
      { cwd, env: credential ? {...env,ARTIFACTBIN_HOME:join(root,'recipient-home'),ARTIFACTBIN_TOKEN:credential,ARTIFACTBIN_SKILLS:'off'} : env, stdio: ['ignore', 'pipe', 'pipe'] });
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
        // The no-click path: a browser already signed in follows the loopback sign-in page straight
        // back to the CLI's own listener. Older candidate CLIs pair through the device page below.
        const opened = (await readFile(openedLog, 'utf8').catch(() => '')).split('\n').find(line => line.includes('/oauth/loopback?'));
        if (opened) {
          const authorized = await fetch(opened, { headers: { Cookie: browserCookie }, redirect: 'manual' });
          assert.equal(authorized.status, 302);
          const landed = await fetch(authorized.headers.get('location'));
          assert.equal(landed.status, 200);
          assert.match(await landed.text(), /Signed in/);
          approved = true;
          return;
        }
        const files = await readdir(home).catch(() => []);
        const file = files.find(name => /^pairing-.*\.json$/.test(name));
        if (!file) return;
        const pairing = JSON.parse(await readFile(join(home, file), 'utf8'));
        const response = await fetch(`${BASE}/oauth/device/approve`, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, Cookie: browserCookie },
          body: new URLSearchParams({ user_code: pairing.userCode, decision: 'approve' }),
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
    if (approve) assert.ok(approved, 'CLI requested real browser sign-in or device approval');
    return JSON.parse(output.trim());
  }
  /** One acceptance scenario: its asserts are the verdict, and a failure does not stop the next scenario. */
  const scenario = (label, body) => lane(check, 'cli').run(() => lane(check, 'cli').step(label, body));
  // Reuse the eval's real email login for deployments; its outbox variant is exercised in CI.
  const ctx = credentialSource ? null : await context();
  const publishedIds = [];
  const { step, run } = lane(check, 'cli');
  try {
    await run(async () => {
      await step('CLI browser login through host authentication', () => invoke(['auth'], { approve: true }));
      const profile = createHash('sha256').update(BASE).digest('hex').slice(0, 16);
      const saved = await readFile(join(home, 'hosts', profile, 'credentials.env'), 'utf8');
      const token = saved.match(/^ARTIFACTBIN_TOKEN=(.+)$/m)?.[1];
      await step('guest session cannot mint a direct HTTP bearer', () => checkGuestHttpIssuance({base:BASE,fetch:globalThis.fetch,guestCookie: ''}));
      let accountCookie;
      let id;
      let read;
      await step('email CLI connection belongs to its approving account', async () => {
        assert.ok(token);
        if (credentialSource) {
          assert.match(accountEmail, /^mxmx_test_/, 'acceptance must use a disposable test account');
          accountCookie = approvingAccount.cookie;
        } else {
          const owner = await ctx.newPage();
          // This fresh browser signs in with the same email as the approving account.
          await loginViaEmail(owner, BASE, sink, accountEmail);
          accountCookie = (await ctx.cookies(BASE)).map(({ name, value }) => `${name}=${value}`).join('; ');
        }
        // The CLI credential and its approving browser belong to the same email account.
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
      await scenario('email-only HTTP issuance, CSV read/write, retired native refusal and HTML filename', () => checkDirectHttp({base:BASE,fetch:globalThis.fetch,accountCookie,artifactId:id,stamp,onArtifact:created=>publishedIds.push(created)}));
      await step('CLI registration and publication preserve dataset identities', async () => {
        read = await api(`/api/artifacts/${id}`);
        assert.equal(read.status, 200);
        assert.match((await read.json()).markup, /<Import name="sales_data" src="ref:/);
      });
      let otherAccount;
      await scenario('owner/non-owner/anonymous private access; leak negative control', async () => {
        otherAccount = await connectConformanceNonOwner({ base: BASE, accountEmail, stamp, credentialSource, env: process.env }, {
          connectAgent,
          acquireCredential: async (...args) => (await tsImport('../../lib/credential.ts', import.meta.url)).acquireCredential(...args),
        });
        const other=otherAccount.token;
        const hidden = status => assert.equal(status, 404, 'private read must remain hidden');
        assert.equal((await api(`/api/artifacts/${id}`, null)).status, 401, 'API requires authentication');
        hidden((await api(`/a/${id}`, null)).status);
        hidden((await api(`/api/artifacts/${id}`, other)).status);
        // Controlled contract violation: the same assertion must reject a leaked private response.
        assert.throws(() => hidden(read.status), /private read must remain hidden/);
      });
      await scenario('group viewer CLI discovery preserves read-only access and revokes on removal',async()=>{
        assert.ok(otherAccount?.token,'Separate verified colleague account is required');
        const otherCookie=credentialSource?otherAccount.cookie:connectionBrowserCookie(BASE,otherAccount.token);
        const session=await fetch(`${BASE}/api/auth/get-session`,{headers:{cookie:otherCookie}});
        assert.equal(session.status,200);const userId=(await session.json())?.user?.id;assert.ok(userId);
        const handle=`mxmx_test_list_${stamp.slice(-12)}`;
        const created=await api('/api/groups',token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'mxmx_test_cli_group',handle})});
        assert.equal(created.status,201);const group=(await created.json());assert.ok(group.id);
        const memberPath=`/api/groups/${group.id}/members/${userId}`;
        const joined=await api(memberPath,token,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({role:'viewer'})});
        assert.equal(joined.status,200);
        try{
          await writeFile(join(workspace,'group-review.jsx'),'---\ntitle: mxmx_test_group_review\nvisibility: private\n---\n<p id="finding">Group viewer review</p>');
          const pushed=await invoke(['push','group-review.jsx','--group',handle]);
          const groupId=pushed.operations.find(item=>item.path.endsWith('group-review.jsx'))?.id;assert.ok(groupId);publishedIds.push(groupId);
          const cwd=join(root,'group-viewer');await mkdir(cwd);const opts={cwd,credential:otherAccount.token};
          assert.ok((await invoke(['list'],opts)).artifacts.some(item=>item.id===groupId),'Viewer discovers the group publication');
          assert.ok(!(await invoke(['list','--filter','relationship=owned'],opts)).artifacts.some(item=>item.id===groupId),'Discovery grants no ownership');
          await invoke(['pull',groupId,'--output','group.jsx'],opts);
          const file=join(cwd,'group.jsx');await writeFile(file,(await readFile(file,'utf8')).replace('Group viewer review','Denied group viewer edit'));
          assert.equal((await invoke(['push','group.jsx'],{...opts,expected:1})).error?.code,'not_found');
          assert.equal((await api(memberPath,token,{method:'DELETE'})).status,200);
          assert.ok(!(await invoke(['list'],opts)).artifacts.some(item=>item.id===groupId),'Removal revokes discovery immediately');
        }finally{assert.equal((await api(memberPath,token,{method:'DELETE'})).status,200);}
      });
      await scenario('colleague share roles, rejected comment recovery and immediate revocation',async()=>{
        assert.ok(otherAccount?.token,'Separate verified colleague account is required');
        const otherCookie=credentialSource?otherAccount.cookie:connectionBrowserCookie(BASE,otherAccount.token);
        const session=await fetch(`${BASE}/api/auth/get-session`,{headers:{cookie:otherCookie}});
        assert.equal(session.status,200);const email=(await session.json())?.user?.email;assert.ok(email);
        await writeFile(join(workspace,'colleague-review.jsx'),'---\ntitle: mxmx_test_colleague_review\nvisibility: private\n---\n<p id="finding">Colleague review finding</p>');
        const created=await invoke(['push','colleague-review.jsx','--personal']);
        const sharedId=created.operations.find(item=>item.path.endsWith('colleague-review.jsx'))?.id;
        assert.ok(sharedId);publishedIds.push(sharedId);
        const share=async(role)=>{
          const response=await fetch(`${BASE}/api/my/artifacts/${sharedId}/sharing`,{method:'PUT',headers:{cookie:accountCookie,origin:BASE,'content-type':'application/json'},body:JSON.stringify({shares:role?[{email,role}]:[]})});
          assert.equal(response.status,200,'Owner can update the colleague share');
        };
        try{
          for(const role of ['viewer','commenter','editor']){
            await share(role);
            const cwd=join(root,`colleague-${role}`);await mkdir(cwd);
            const opts={cwd,credential:otherAccount.token};
            const comment=await invoke(['comment',sharedId,'--quote','Colleague review finding','--body',`mxmx_test_${role}_review`],{...opts,expected:role==='viewer'?1:0});
            if(role==='viewer')assert.equal(comment.error?.code,'not_found');
            // This read immediately after a denied comment catches a stuck local journal.
            await invoke(['pull',sharedId,'--output','shared.jsx'],opts);
            const file=join(cwd,'shared.jsx');const before=await readFile(file,'utf8');
            await writeFile(file,before.replace('Colleague review finding',`mxmx_test_${role}_edit`));
            const edited=await invoke(['push','shared.jsx'],{...opts,expected:role==='editor'?0:1});
            if(role!=='editor')assert.equal(edited.error?.code,'not_found');
            else{
              const state=await api(`/api/artifacts/${sharedId}`);assert.equal(state.status,200);
              assert.match((await state.json()).markup,/mxmx_test_editor_edit/);
            }
          }
          await share(null);
          assert.equal((await api(`/api/artifacts/${sharedId}`,otherAccount.token)).status,404,'Revoked recipient cannot read the private document');
        }finally{await share(null);}
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
