/**
 * Gate: LIVE BROWSER SESSIONS AND THE TEST USERS THEY RUN AS — real CLI, real artifact runtime, OS containment.
 *
 * Needs Linux + bubblewrap for the containment half (lib/session-containment names what a host without the
 * sandbox skips, and why); CI and scripts/gate-container.mjs have both. Two legs, run one after the other because
 * the server holds two sessions at a time (BROWSER__SESSION_MAX) and each leg holds two:
 *
 *   sessions   (formerly gate-browser-sessions) one script drives two documents through `window.page` and the
 *              page's own script agrees; a session resumes, fails, reports a receipt, is contained (filesystem,
 *              network, credentials), is invisible to a stranger, and is lost — not hung — past its deadline;
 *              an agent-shaped widget and a session drive the same names in both directions.
 *   testusers  (formerly gate-testusers) an account mints a test user, forks the production Splitwise shape to it,
 *              joins the COPY as that person and as the account, sees the person named, is refused BY NAME on
 *              the ORIGINAL, then erases — and the original never changed.
 *
 *   usage: node scripts/gates/gate-sessions.mjs [base]
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createChecker } from './lib/assert.mjs';
import { lane } from './lib/lane.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { connectAgent } from './lib/cli-connection.mjs';
import { containmentExpectation, containmentObserved } from './lib/session-containment.mjs';
import { startMailSink } from '../lib/mail-login.mjs';

const base = process.argv[2] ?? 'http://localhost:3030';
const origin = new URL(base).origin;
const check = createChecker('sessions');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (value) => JSON.stringify(value)?.slice(0, 600);
const scratch = await mkdtemp(path.join(tmpdir(), 'afbin-sessions-gate-'));

/** The branch's CLI, as a bearer's agent runs it: `--json` out, a script file in. */
const cliAs = (token) => async (args, code) => {
  const file = path.join(scratch, `${randomUUID()}.js`);
  if (code !== undefined) await writeFile(file, code);
  const child = spawn(process.execPath, ['services/cli/dist/afbin.mjs', ...args, ...(code === undefined ? [] : ['--input', file]), '--server', base, '--json'], {
    env: { ...process.env, ARTIFACTBIN_TOKEN: token, ARTIFACTBIN_URL: base, HOME: scratch }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  try { return JSON.parse(stdout); } catch { throw new Error(`Invalid CLI output: ${stderr.slice(-1000)}`); }
};

const evidence = path.resolve('tmp/browser-session-evidence');
await mkdir(evidence, { recursive: true });
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const saveImage = async (name, attachment) => {
  const bytes = Buffer.from(attachment.base64, 'base64');
  await writeFile(path.join(evidence, `${name}.png`), bytes);
  return bytes.subarray(0, 8).equals(PNG);
};

// ── sessions: the worker, the runtime and the sandbox ────────────────────────
async function sessionsLeg() {
  const { must, run } = lane(check, 'sessions');
  const token = (await connectAgent(base)).token;
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const request = async (body, credential = token) => {
    const response = await fetch(`${base}/api/browser-sessions`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${credential}` }, body: JSON.stringify(body) });
    if (response.status !== 200) throw new Error(`/api/browser-sessions → ${response.status}`);
    return response.json();
  };
  const cli = (args, code) => cliAs(token)(['sessions', ...args], code);
  const ids = [];
  /** Which of the probe's four facts this host can be asked about; see lib/session-containment.mjs. */
  let skipped = [];
  try {
    await run(async () => {
      // The counter's own Helmet script renders the count through an effect over the `count` signal; the session
      // drives the very same signal through `window.page`.
      const counterScript = [
        "import { signal } from 'page';",
        "import { createEffect } from 'solid-js';",
        "const [count, setCount] = signal('$count');",
        "createEffect(() => { document.getElementById('value').textContent = String(count()); });",
        "document.getElementById('add').addEventListener('click', () => { setCount(count() + 1); });",
      ].join('\n');
      const markup = count => '<Helmet><Value name="count" type="number" default={' + count + '}/><Query name="result">{`select $count as n`}</Query><script>{' + JSON.stringify(counterScript) + '}</script></Helmet><h1>Session counter</h1><Number data="$result" col="n"/><button id="add">Add one</button><p id="value">Waiting</p>';
      const artifacts = [];
      for (const count of [1, 7]) {
        const response = await fetch(`${base}/api/artifacts`, { method: 'POST', headers, body: JSON.stringify({ markup: markup(count) }) });
        const artifact = await response.json();
        must(artifact.id, `the counter document (${count}) is published ${show(artifact)}`);
        artifacts.push(artifact.id);
      }
      const first = await cli(['script', 'new'], `
        const opened = await Promise.all(${JSON.stringify(artifacts)}.map(async id => {
          const page = await context.newPage(); await page.goto('/a/'+id);
          await page.locator('#value').filter({hasText:/^[0-9]+$/}).waitFor();
          await page.waitForFunction(() => Boolean(window.page));
          return page;
        }));
        await opened[0].evaluate(() => { window.page.set('count', 3); });
        await opened[0].locator('#value').filter({hasText:/^3$/}).waitFor();
        const states = await Promise.all(opened.map(page => page.evaluate(async () => ({
          count: window.page.get('count'),
          result: await window.page.ready('result'),
          shown: document.getElementById('value').textContent,
        }))));
        await output.image(await opened[0].screenshot());
        return states;
      `);
      // Recorded before the verdict: a failed run still closes its session, so a retry is not refused for capacity.
      if (first.session_id) ids.push(first.session_id);
      must(first.status === 'completed', `a script opens two documents in one session ${show(first)}`);
      check(first.pages?.length === 2, 'the session holds both pages');
      check(first.attachments?.[0]?.mime === 'image/png', 'the script returned a PNG screenshot');
      check(await saveImage('counter', first.attachments[0]), 'the screenshot is a real PNG');
      check(same(first.result.map(s => s.count), [3, 7]), `window.page set one page and left the other ${show(first.result)}`);
      check(same(first.result.map(s => s.shown), ['3', '7']), 'the page script rendered the signal the session set');
      check(same(first.result.map(s => s.result.map(row => row.n)), [[3], [7]]), 'the dependent query re-ran for the set value');
      const pageId = first.pages.find(page => page.artifact_id === artifacts[0]).page_id;
      const resumed = await cli(['script', first.session_id], `
        const page = pages[${JSON.stringify(pageId)}];
        await page.getByRole('button',{name:'Add one'}).click();
        await page.locator('#value').filter({hasText:/^4$/}).waitFor();
        return await page.evaluate(() => ({ count: window.page.get('count') }));
      `);
      must(resumed.status === 'completed', `the session resumes ${show(resumed)}`);
      check(resumed.result.count === 4, "the page's own button moved the session's signal");
      check(resumed.pages.some(page => page.page_id === pageId), 'the resumed session keeps the page by id');
      const failure = await cli(['script', first.session_id], 'throw new Error("intentional failure");');
      check(failure.status === 'failed' && failure.pages?.length === 2, 'a failing script reports failed and keeps the session');
      const probe = await cli(['script', first.session_id], `
        const fs = await import('node:fs/promises');
        let checkout=false, network=false;
        try { await fs.readFile(${JSON.stringify(path.resolve('package.json'))}); checkout=true; } catch {}
        try { await fetch(${JSON.stringify(base)}, {signal:AbortSignal.timeout(300)}); network=true; } catch {}
        await fs.writeFile('own.txt','ok');
        return {checkout,network,own:await fs.readFile('own.txt','utf8'),credentials:Object.keys(process.env).filter(key=>/SECRET|TOKEN|API_KEY/.test(key))};
      `);
      // The SERVER says whether it ran this session sandboxed; the host's own opinion is not consulted.
      const containment = containmentExpectation(first.sandbox);
      skipped = containment.skipped;
      check(same(containmentObserved(probe.result, containment.expected), containment.expected), `${skipped.length ? 'credential-free worker environment' : 'filesystem/network containment'} ${show(probe)}`);
      const stranger = (await connectAgent(base)).token;
      check((await request({ op: 'status', session_id: first.session_id }, stranger)).error?.code === 'SESSION_NOT_FOUND', 'a stranger cannot see the session: SESSION_NOT_FOUND');
      const receipt = await cli(['status', first.session_id, '--execution', resumed.execution_id]);
      check(same(receipt.result, resumed.result), 'the execution receipt recovers the result');
      const lost = await cli(['script', first.session_id], 'while(true) {}');
      check(lost.status === 'lost' && lost.error?.code === 'SESSION_LOST', `a script past the hard deadline loses the session ${show(lost)}`);
      const refused = await cli(['script', first.session_id], 'return 1');
      check(refused.error?.code === 'SESSION_LOST', 'a lost session refuses the next script: SESSION_LOST');

      // An agent-shaped widget: the page's own script builds the controls and renders through `effect`, and a
      // session drives the same names through `window.page` — the two must agree in both directions.
      const widgetScript = [
        "import { signal, query, mutation } from 'page';",
        "import { createEffect } from 'solid-js';",
        "const [region, setRegion] = signal('$region'); const sales = query('$sales'); const addTask = mutation('$addTask');",
        "const host = document.getElementById('agent-widget');",
        "const regionEl = document.createElement('select'); regionEl.setAttribute('aria-label', 'Region');",
        "for (const name of ['East', 'West']) { const option = document.createElement('option'); option.value = name; option.textContent = name; regionEl.append(option); }",
        "const table = document.createElement('table'); const rowsEl = document.createElement('tbody'); table.append(rowsEl);",
        "const labelEl = document.createElement('input'); labelEl.setAttribute('aria-label', 'Task title');",
        "const addBtn = document.createElement('button'); addBtn.textContent = 'Add task';",
        "const errorEl = document.createElement('p');",
        "host.replaceChildren(regionEl, table, labelEl, addBtn, errorEl);",
        "createEffect(() => { if (regionEl.value !== String(region())) regionEl.value = String(region()); });",
        "createEffect(() => {",
        "  rowsEl.replaceChildren(...sales().map(row => { const tr = document.createElement('tr'); for (const v of [row.name, row.revenue]) { const td = document.createElement('td'); td.textContent = String(v); tr.append(td); } return tr; }));",
        "  errorEl.textContent = sales.error() ?? '';",
        "});",
        "regionEl.addEventListener('change', () => { setRegion(regionEl.value); });",
        "addBtn.addEventListener('click', async () => {",
        "  const title = labelEl.value.trim(); if (!title) return;",
        "  addBtn.disabled = true;",
        "  try { await addTask({ taskTitle: title }); } catch (error) { errorEl.textContent = error.message; } finally { addBtn.disabled = false; }",
        "});",
      ].join('\n');
      const agentMarkup = '<Helmet><Value name="region" default="East"/><Value name="taskTitle" default="untouched"/><Value name="tasks" type="table" value={[{title:"Existing"}]}/><Query name="sales">{`select $region || \' total\' as name, case when $region=\'West\' then 200 else 100 end as revenue`}</Query><Mutation name="addTask">{`insert into tasks (title) values ($taskTitle)`}</Mutation><script>{' + JSON.stringify(widgetScript) + '}</script></Helmet><h1>Agent transfer fixture</h1><div id="agent-widget">Loading widget</div>';
      const agentArtifact = await (await fetch(`${base}/api/artifacts`, { method: 'POST', headers, body: JSON.stringify({ markup: agentMarkup }) })).json();
      must(agentArtifact.id, `the widget document is published ${show(agentArtifact)}`);
      const opened = await cli(['script', 'new'], `
        const page = await context.newPage(); await page.goto(${JSON.stringify('/a/')}+${JSON.stringify(agentArtifact.id)});
        await page.getByLabel('Region').waitFor();
        await page.waitForFunction(() => Boolean(window.page));
        return await page.evaluate(() => ({ region: window.page.get('region'), sales: window.page.get('sales'), tasks: window.page.get('tasks') }));
      `);
      if (opened.session_id) ids.push(opened.session_id);
      must(opened.status === 'completed', `a session opens the widget ${show(opened)}`);
      check(opened.result.region === 'East', 'the session reads the default region');
      check(same(opened.result.tasks.map(row => row.title), ['Existing']), 'the session reads the table value');
      const agentPageId = opened.pages[0].page_id;
      const mutated = await cli(['script', opened.session_id], `
        const page = pages[${JSON.stringify(agentPageId)}];
        return await page.evaluate(async () => {
          await window.page.mutation('addTask')({ taskTitle: 'Session task' });
          return { tasks: await window.page.ready('tasks'), taskTitle: window.page.get('taskTitle') };
        });
      `);
      must(mutated.status === 'completed', `the session runs the mutation ${show(mutated)}`);
      check(mutated.result.taskTitle === 'untouched', 'a mutation argument applies to that call only');
      check(mutated.result.tasks.some(row => row.title === 'Session task'), `the mutation's row arrived ${show(mutated.result)}`);
      const widget = await cli(['script', opened.session_id], `
        const page = pages[${JSON.stringify(agentPageId)}];
        await page.getByLabel('Region').selectOption('West');
        await page.getByText('West total',{exact:true}).waitFor();
        await page.evaluate(() => { window.page.set('region', 'East'); });
        await page.getByText('East total',{exact:true}).waitFor();
        if (await page.getByLabel('Region').inputValue()!=='East') throw new Error('Page selection did not synchronize');
        await page.getByLabel('Task title').fill('Widget task');
        await page.getByRole('button',{name:'Add task'}).click();
        await page.waitForFunction(() => window.page.get('tasks').some(row => row.title === 'Widget task'), null, { timeout: 5000 });
        await page.waitForFunction(() => !document.querySelector('#agent-widget button').disabled, null, { timeout: 5000 });
        await output.image(await page.screenshot());
        return await page.evaluate(() => ({ region: window.page.get('region'), taskTitle: window.page.get('taskTitle'), tasks: window.page.get('tasks').map(row => row.title) }));
      `);
      must(widget.status === 'completed', `the page's controls and window.page drive the same names both ways ${show(widget)}`);
      check(widget.result.taskTitle === 'untouched', "the widget's mutation argument applies to that call only");
      check(widget.result.region === 'East', 'the region the session set is the one the page shows');
      check(same(widget.result.tasks, ['Existing', 'Session task', 'Widget task']), 'the widget and the session wrote the same table');
      check(widget.attachments?.length === 1 && await saveImage('page-widget', widget.attachments[0]), 'the widget screenshot is a real PNG');
      if (skipped.length) check.note(`SKIPPED on this host (server reports sandbox: none): ${skipped.join(', ')} — Linux CI asserts them.`);
    });
  } finally {
    for (const session_id of ids) await request({ op: 'close', session_id }).catch(() => {});
  }
}

// ── testusers: mint, fork as, join, refuse, erase ────────────────────────────
async function testusersLeg() {
  const { must, run } = lane(check, 'testusers');
  // A test user is minted by an ACCOUNT, so the bearer is paired to one: sign a person in through the real
  // email-code door, then approve the CLI's device pairing from that browser session (never "continue anonymously").
  const email = `mxmx_test_testusers_${Date.now()}@example.com`;
  let token = null;
  await run(async () => {
    const sink = await startMailSink();
    const post = (route, body, cookie) => fetch(`${origin}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    must((await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })).ok, 'login code requested');
    const otp = sink.lastCode(email);
    must(otp, 'a login code reached the development outbox');
    const signedIn = await post('/api/auth/sign-in/email-otp', { email, otp });
    must(signedIn.status === 200, `the account signs in (${signedIn.status})`);
    const cookie = signedIn.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const pairing = await (await fetch(`${origin}/oauth/device`, { method: 'POST' })).json();
    const advertised = new URL(pairing.verification_uri ?? pairing.verification_url ?? origin).origin;
    const approved = await fetch(`${origin}/oauth/device/approve`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', origin: advertised, Cookie: cookie }, body: new URLSearchParams({ user_code: pairing.user_code, decision: 'approve' }) });
    must(approved.ok, `device approval ${approved.status}`);
    const granted = await (await fetch(`${origin}/oauth/device/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_code: pairing.device_code }) })).json();
    must(granted?.access_token, `the account's CLI connection is granted ${show(granted)}`);
    token = granted.access_token;
  });
  if (!token) return;

  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const api = async (method, route, body) => {
    const response = await fetch(`${base}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  };
  const cli = cliAs(token);
  const sessions = [];
  let testuser;
  try {
    await run(async () => {
      // The production shape: the reference's two-table dataset, viewers-write, and the real page.
      const dataset = `<Dataset kind="stored">
  <Table schema="public" name="people" rows={[]} columns={[{"name":"person","type":"user","constraints":{"self":true}},{"name":"joined_on","type":"date"}]} />
  <Table schema="public" name="expenses" rows={[]} columns={[{"name":"id","type":"string"},{"name":"paid_by","type":"user","constraints":{"self":true}},{"name":"spent_on","type":"date"},{"name":"item","type":"string"},{"name":"amount","type":"number"}]} />
</Dataset>`;
      const ds = await api('POST', '/api/artifacts', { dataset, access: 'readwrite', visibility: 'unlisted', title: 'Splitwise tab' });
      must(ds.status === 201, `the Splitwise dataset is published ${show(ds.json)}`);
      const policy = { version: 1, enforcement: 'enabled', tables: ['people', 'expenses'].map(name => ({ table: { schema: 'public', name },
        insert_permissions: [{ role: 'viewer', permission: { columns: '*', check: {} } }],
        update_permissions: [{ role: 'viewer', permission: { columns: '*', filter: {}, check: {} } }],
        delete_permissions: [{ role: 'viewer', permission: { filter: {} } }] })) };
      const grantedPolicy = await api('PATCH', `/api/artifacts/${ds.json.id}`, { policy, expectedPolicyRevision: 0 });
      must(grantedPolicy.status === 200, `viewers may write the dataset ${show(grantedPolicy.json)}`);
      // The real page as published: it declares data and carries no script, so `window.page` is all a session drives.
      const page = (await readFile(new URL('../../services/app/__tests__/fixtures/splitwise-2RbE7f.jsx', import.meta.url), 'utf8')).replaceAll('ref:hf8fYY', `ref:${ds.json.id}`);
      const doc = await api('POST', '/api/artifacts', { markup: page, visibility: 'unlisted', title: 'Splitwise tracker' });
      must(doc.status === 201, `the Splitwise page is published ${show(doc.json)}`);
      const original = doc.json.id;
      const before = await api('GET', `/api/artifacts/${original}`);

      // Mint, fork as, and look at what was made.
      testuser = await cli(['testuser', 'new']);
      must(/^usr_/.test(testuser.id ?? ''), `a test user is minted ${show(testuser)}`);
      check(testuser.token === undefined, 'the mint reply must not carry a bearer secret');
      const fork = await cli(['fork', original, '--as', testuser.id]);
      const op = fork.operations?.[0];
      must(op?.status === 'created', `fork --as makes a copy ${show(fork)}`);
      check(same(op.owner, { testuser: testuser.id }), 'the copy belongs to the test user');
      check(op.datasets?.length === 1, 'the written dataset is copied under the test user');
      const copy = op.id;

      // The test user joins its COPY through the page, and is refused BY NAME on the original — including a
      // write issued the instant `window.page` exists: while the permission answer is in flight the page says
      // so (ACCESS_PENDING), and the driver retries until it has the answer.
      const driver = `
        const until = async (page) => { await page.waitForFunction(() => Boolean(window.page), null, { timeout: 15000 }); };
        const mutate = (page, name) => page.evaluate(async (name) => {
          for (let n = 0; n < 150; n++) {
            try { await window.page.mutation(name)({}); return { committed: true }; }
            catch (e) { if (e.message !== ${JSON.stringify('Checking edit access…')}) return { message: e.message }; }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          return { message: 'the permission answer never arrived' };
        }, name);
        const people = (page) => page.evaluate(async () => (await window.page.ready('balances')).map(r => r.person));
      `;
      const joined = await cli(['sessions', 'script', 'new', '--as', testuser.id], `${driver}
        const page = await context.newPage(); const nav = await page.goto(${JSON.stringify(`/a/${copy}`)});
        const ready = await until(page).then(() => true, () => false);
        if (!ready) return { debug: { status: nav?.status(), url: page.url(), frames: page.frames().map(f => f.url()), body: (await page.content()).slice(0, 1500) } };
        const receipt = await mutate(page, 'join');
        await page.getByRole('button', { name: 'Join this tab' }).waitFor();
        const balances = await people(page);
        const real = await context.newPage(); await real.goto(${JSON.stringify(`/a/${original}`)});
        await until(real);
        const refused = await mutate(real, 'join');
        await output.image(await page.screenshot());
        return { receipt, people: balances, refused };
      `);
      // Recorded before the verdict: a failed run still closes its session, so a retry is not refused for capacity.
      if (joined.session_id) sessions.push(joined.session_id);
      must(joined.status === 'completed' && joined.result?.receipt, `the test user's session opens its copy ${show(joined)}`);
      check(joined.result.receipt.committed === true, `the test user joins the copy ${show(joined.result.receipt)}`);
      check(same(joined.result.people, [testuser.id]), 'the copy lists the test user');
      check(joined.result.refused?.committed === undefined, 'the original refuses the test user');
      check(/sandbox/.test(joined.result.refused?.message ?? ''), 'the refusal names the sandbox, never a placeholder');

      // The account looks at the copy: the test user is named, and joining works for the account too.
      const mine = await cli(['sessions', 'script', 'new'], `${driver}
        const page = await context.newPage(); await page.goto(${JSON.stringify(`/a/${copy}`)});
        await until(page);
        const receipt = await mutate(page, 'join');
        if (!receipt.committed) throw new Error('the account could not join: ' + receipt.message);
        const people_ = await people(page);
        await page.getByText(${JSON.stringify(testuser.label)}).first().waitFor({ timeout: 10000 }).catch(() => {});
        const body = await page.locator('body').innerText();
        return { people: people_, body };
      `);
      if (mine.session_id) sessions.push(mine.session_id);
      must(mine.status === 'completed', `the account joins the copy too ${show(mine)}`);
      check(mine.result.people.length === 2, 'the copy lists both people');
      check(mine.result.body.includes(testuser.label), `the copy names ${testuser.label}; body was: ${mine.result.body.slice(0, 400)}`);
      check(!mine.result.body.includes('Unknown person'), 'no row renders as an unknown person');

      // Erase: the copy and its dataset are gone, the original is byte-identical, and the person is gone.
      const listed = await cli(['testuser', 'list']);
      check(listed.testusers?.find(t => t.id === testuser.id)?.artifacts === 2, `the list counts the test user's two artifacts ${show(listed)}`);
      const erased = await cli(['testuser', 'delete', testuser.id]);
      check(erased.erased?.artifacts === 2, `erase removes both ${show(erased)}`);
      testuser = null;
      check((await api('GET', `/api/artifacts/${copy}`)).status === 404, 'the erased copy is the uniform 404');
      const after = await api('GET', `/api/artifacts/${original}`);
      check(same(after.json, before.json), 'the original artifact is untouched by everything the sandbox did');
      const rows = await fetch(`${base}/a/${original}/query`, { method: 'POST', headers, body: '{}' }).then(r => r.json());
      check(same(rows.tables?.balances?.rows, []), 'the original tab is still empty');
    });
  } finally {
    for (const id of sessions) await cli(['sessions', 'close', id]).catch(() => {});
    if (testuser?.id) await cli(['testuser', 'delete', testuser.id]).catch(() => {});
  }
}

try {
  await sessionsLeg();
  await testusersLeg();
} finally {
  await rm(scratch, { recursive: true, force: true });
}
check.done();
