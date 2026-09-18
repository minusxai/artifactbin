/**
 * TEST USERS, END TO END, IN A REAL BROWSER: mint one, fork the production
 * Splitwise shape to it, join the COPY as that person and as the account, see
 * the person named, be refused by name on the ORIGINAL, then erase — and prove
 * the original never changed. This is the loop an agent runs to verify an app;
 * it needs Linux + bubblewrap like every session gate.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { startMailSink } from './lib/mail-login.mjs';

const base = process.argv[2] ?? 'http://localhost:3030';
const origin = new URL(base).origin;
// A test user is minted by an ACCOUNT, so the gate's bearer is paired to one:
// sign a person in through the real email-code door, then approve the CLI's
// device pairing from that browser session (never "continue anonymously").
const email = `mxmx_test_testusers_${Date.now()}@example.com`;
const token = await (async () => {
  const sink = await startMailSink();
  const post = (route, body, cookie) => fetch(`${origin}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  assert((await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })).ok, 'login code requested');
  const otp = sink.lastCode(email);
  assert(otp, 'a login code reached the development outbox');
  const signedIn = await post('/api/auth/sign-in/email-otp', { email, otp });
  assert.equal(signedIn.status, 200, await signedIn.text());
  const cookie = signedIn.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const pairing = await (await fetch(`${origin}/oauth/device`, { method: 'POST' })).json();
  const advertised = new URL(pairing.verification_uri ?? pairing.verification_url ?? origin).origin;
  const approved = await fetch(`${origin}/oauth/device/approve`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', origin: advertised, Cookie: cookie }, body: new URLSearchParams({ user_code: pairing.user_code, decision: 'approve' }) });
  assert(approved.ok, `device approval ${approved.status}`);
  const granted = await (await fetch(`${origin}/oauth/device/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_code: pairing.device_code }) })).json();
  assert(granted?.access_token, JSON.stringify(granted));
  return granted.access_token;
})();
const scratch = await mkdtemp(path.join(tmpdir(), 'afbin-testusers-gate-'));
const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const api = async (method, route, body) => {
  const response = await fetch(`${base}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
};
const cli = async (args, code) => {
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
const sessions = [];
let testuser;
try {
  // The production shape: the reference's two-table dataset, viewers-write, and the real page.
  const dataset = `<Dataset kind="stored">
  <Table schema="public" name="people" rows={[]} columns={[{"name":"person","type":"user","constraints":{"self":true}},{"name":"joined_on","type":"date"}]} />
  <Table schema="public" name="expenses" rows={[]} columns={[{"name":"id","type":"string"},{"name":"paid_by","type":"user","constraints":{"self":true}},{"name":"spent_on","type":"date"},{"name":"item","type":"string"},{"name":"amount","type":"number"}]} />
</Dataset>`;
  const ds = await api('POST', '/api/artifacts', { dataset, access: 'readwrite', visibility: 'unlisted', title: 'Splitwise tab' });
  assert.equal(ds.status, 201, JSON.stringify(ds.json));
  const policy = { version: 1, enforcement: 'enabled', tables: ['people', 'expenses'].map(name => ({ table: { schema: 'public', name },
    insert_permissions: [{ role: 'viewer', permission: { columns: '*', check: {} } }],
    update_permissions: [{ role: 'viewer', permission: { columns: '*', filter: {}, check: {} } }],
    delete_permissions: [{ role: 'viewer', permission: { filter: {} } }] })) };
  const granted = await api('PATCH', `/api/artifacts/${ds.json.id}`, { policy, expectedPolicyRevision: 0 });
  assert.equal(granted.status, 200, JSON.stringify(granted.json));
  const page = (await readFile(new URL('../services/app/__tests__/fixtures/splitwise-2RbE7f.jsx', import.meta.url), 'utf8')).replaceAll('ref:hf8fYY', `ref:${ds.json.id}`);
  const doc = await api('POST', '/api/artifacts', { markup: page, visibility: 'unlisted', title: 'Splitwise tracker' });
  assert.equal(doc.status, 201, JSON.stringify(doc.json));
  const original = doc.json.id;
  const before = await api('GET', `/api/artifacts/${original}`);

  // Mint, fork as, and look at what was made.
  testuser = await cli(['testuser', 'new']);
  assert.match(testuser.id ?? '', /^usr_/, JSON.stringify(testuser));
  assert.equal(testuser.token, undefined, 'the mint reply must not carry a bearer secret');
  const fork = await cli(['fork', original, '--as', testuser.id]);
  const op = fork.operations?.[0];
  assert.equal(op?.status, 'created', JSON.stringify(fork));
  assert.deepEqual(op.owner, { testuser: testuser.id });
  assert.equal(op.datasets?.length, 1, 'the written dataset is copied under the test user');
  const copy = op.id;

  // The test user joins its COPY through the page, and is refused BY NAME on the original —
  // including a mutate issued the instant `window.mx` exists (the permission answer is awaited).
  const joined = await cli(['sessions', 'script', 'new', '--as', testuser.id], `
    const page = await context.newPage(); const nav = await page.goto('/a/${copy}');
    const ready = await page.waitForFunction(() => Boolean(window.mx), null, { timeout: 15000 }).then(() => true).catch(() => false);
    if (!ready) return { debug: { status: nav?.status(), url: page.url(), body: (await page.content()).slice(0, 1500) } };
    const receipt = await page.evaluate(() => mx.mutate('join', {}));
    await page.getByRole('button', { name: 'Join this tab' }).waitFor();
    const balances = await page.evaluate(() => mx.read(['balances'], {wait:true}));
    const real = await context.newPage(); await real.goto('/a/${original}');
    await real.waitForFunction(() => Boolean(window.mx));
    const refused = await real.evaluate(async () => { try { await mx.mutate('join', {}); return null; } catch (e) { return { code: e.code, message: e.message }; } });
    await output.image(await page.screenshot());
    return { receipt, people: balances.signals.balances.value.rows.map(r => r.person), refused };
  `);
  assert.equal(joined.status, 'completed', JSON.stringify(joined)); sessions.push(joined.session_id);
  assert(joined.result.receipt, JSON.stringify(joined.result));
  assert.equal(joined.result.receipt.status, 'committed');
  assert.deepEqual(joined.result.people, [testuser.id]);
  assert.equal(joined.result.refused.code, 'FORBIDDEN');
  assert.match(joined.result.refused.message, /sandbox/, 'the refusal names the sandbox, never a placeholder');

  // The account looks at the copy: the test user is named, and joining works for the account too.
  const mine = await cli(['sessions', 'script', 'new'], `
    const page = await context.newPage(); await page.goto('/a/${copy}');
    await page.waitForFunction(() => Boolean(window.mx));
    await page.evaluate(() => mx.mutate('join', {}));
    const snapshot = await page.evaluate(() => mx.read(['balances'], {wait:true}));
    const names = await page.locator('[data-mx-user], td').allInnerTexts().catch(() => []);
    const body = await page.locator('body').innerText();
    return { people: snapshot.signals.balances.value.rows.map(r => r.person), body };
  `);
  assert.equal(mine.status, 'completed', JSON.stringify(mine)); sessions.push(mine.session_id);
  assert.equal(mine.result.people.length, 2);
  assert(mine.result.body.includes(testuser.label), `the copy names ${testuser.label}; body was: ${mine.result.body.slice(0, 400)}`);
  assert(!mine.result.body.includes('Unknown person'), 'no row renders as an unknown person');

  // Erase: the copy and its dataset are gone, the original is byte-identical, and the person is gone.
  const listed = await cli(['testuser', 'list']);
  assert.equal(listed.testusers.find(t => t.id === testuser.id)?.artifacts, 2, JSON.stringify(listed));
  const erased = await cli(['testuser', 'delete', testuser.id]);
  assert.equal(erased.erased?.artifacts, 2, JSON.stringify(erased));
  testuser = null;
  assert.equal((await api('GET', `/api/artifacts/${copy}`)).status, 404);
  const after = await api('GET', `/api/artifacts/${original}`);
  assert.deepEqual(after.json, before.json, 'the original artifact is untouched by everything the sandbox did');
  const rows = await fetch(`${base}/a/${original}/query`, { method: 'POST', headers, body: '{}' }).then(r => r.json());
  assert.deepEqual(rows.tables.balances.rows, [], 'the original tab is still empty');
  console.log('testusers: mint, fork --as, join the copy as the person and the account, named in the copy, refused by name on the original, erased whole with the original untouched');
} finally {
  for (const id of sessions) await cli(['sessions', 'close', id]).catch(() => {});
  if (testuser?.id) await cli(['testuser', 'delete', testuser.id]).catch(() => {});
  await rm(scratch, { recursive: true, force: true });
}
