import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startDocument, becomeOwner } from './lib/start-doc.mjs';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';
const base = process.argv[2] ?? 'http://localhost:3030';
const seed = await startDocument(base);
const publish = async (body) => {
  const r = await fetch(`${base}/api/artifacts`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${seed.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  assert.equal(r.status, 201, await r.clone().text());
  return r.json();
};
const dataset = await publish({
  dataset: [{ branch: 'root' }],
  access: 'readwrite',
});
const doc = await publish({
  markup: `<Helmet><Value name="branch" default="new branch"/><Query name="tree" source="ref:${dataset.id}">{\`select * from public.rows\`}</Query><Mutation name="append" source="ref:${dataset.id}">{\`insert into public.rows values ($branch)\`}</Mutation><Mutation name="delete" source="ref:${dataset.id}">{\`delete from public.rows\`}</Mutation></Helmet><h1>Shared policy tree</h1><Button run="$append">Append branch</Button><Button run="$delete">Delete tree</Button><DataTable data="$tree"/><Iframe title="Policy action" height={120}><button id="action" disabled>Script append</button><script>{\`const action=document.getElementById('action');const sync=()=>{action.disabled=!mx.canMutate('append');};mx.data.subscribe(sync);sync();action.onclick=()=>mx.mutate('append');\`}</script></Iframe>`,
});
const browser = await chromium.launch();
const sink = await startMailSink();
try {
  const owner = await browser.newPage();
  await becomeOwner(owner, base, seed.token);
  const guest = await browser.newPage(),
    second = await browser.newPage();
  await guest.goto(doc.url);
  await second.goto(doc.url);
  await guest
    .getByRole('button', { name: 'Append branch', exact: true })
    .waitFor();
  assert(
    await guest
      .getByRole('button', { name: 'Append branch', exact: true })
      .isDisabled(),
  );
  const editor = await browser.newPage();
  const email = `mxmx_test_policy_editor_${Date.now()}@example.com`;
  await loginViaEmail(editor, base, sink, email);
  const grant = await owner.request.put(`${base}/api/my/artifacts/${dataset.id}/sharing`, {data:{shares:[{email,role:'editor'}]}});
  assert.equal(grant.status(),200);
  await editor.goto(`${base}/a/${dataset.id}/edit`);
  await editor
    .getByRole('button', { name: 'Open artifact controls', exact: true })
    .click();
  await editor.getByRole('dialog', {name:'Artifact controls'}).getByRole('button', { name: 'Share', exact: true }).click();
  const recipient='mxmx_test_policy_recipient@example.com';
  await editor.getByLabel('Invite email').fill(recipient);
  await editor.getByLabel('Add email').click();
  await editor.getByLabel(`Role for ${recipient}`).click();
  await editor.getByRole('option',{name:/can edit/}).click();
  const sharing=await editor.request.get(`${base}/api/my/artifacts/${dataset.id}/sharing`);
  assert((await sharing.json()).shares.some(s=>s.email===recipient&&s.role==='editor'));
  await editor.getByLabel('Close sharing', {exact:true}).click();
  await editor.getByLabel('Dismiss artifact controls').click();
  await editor.getByLabel('Allow insert', { exact: true }).check();
  await editor.getByLabel('Add insert check condition', {exact:true}).click();
  await editor.getByLabel('insert check.1.1 value', {exact:true}).fill('"blocked"');
  await editor.getByLabel('Add insert check condition', {exact:true}).click();
  await editor.getByLabel('insert check.2.1 operator', {exact:true}).selectOption('_neq');
  await editor.getByLabel('insert check.2.1 value', {exact:true}).fill('"blocked"');
  await editor.getByLabel('Remove insert check.1.1 condition', {exact:true}).click();
  assert.equal(await editor.getByLabel('insert check.1.1 operator', {exact:true}).inputValue(), '_neq');
  await editor
    .getByRole('button', { name: 'Save access policies', exact: true })
    .click();
  await editor.getByText('Access policies saved.', { exact: true }).waitFor();
  await guest.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent === 'Append branch' && !b.disabled,
    ),
  );
  assert(
    await guest
      .getByRole('button', { name: 'Delete tree', exact: true })
      .isDisabled(),
  );
  const scriptAction = guest
    .frameLocator('iframe[title="Policy action"]')
    .frameLocator('iframe')
    .getByRole('button', { name: 'Script append', exact: true });
  await scriptAction.waitFor();
  await guest.waitForFunction(() => true);
  for (let i = 0; i < 100 && (await scriptAction.isDisabled()); i++)
    await guest.waitForTimeout(50);
  assert(
    !(await scriptAction.isDisabled()),
    'managed scripts receive the data policy',
  );
  await guest
    .getByRole('button', { name: 'Append branch', exact: true })
    .click();
  await second.getByText('new branch', { exact: true }).waitFor();
  await second.reload();
  await second.getByText('new branch', { exact: true }).waitFor();
  const forged = await guest.request.post(`${base}/a/${doc.id}/mutate`, {
    data: { mutation: 'delete' },
  });
  assert(forged.status() >= 400);
  const raw = await fetch(`${base}/api/artifacts/${dataset.id}/mutate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${seed.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql: `delete from public.rows` }),
  });
  assert(
    raw.status >= 400,
    'editor without a matching policy cannot bypass it',
  );
  await editor.getByLabel('Allow insert', {exact:true}).uncheck();
  await editor
    .getByRole('button', { name: 'Save access policies', exact: true })
    .click();
  await guest.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent === 'Append branch' && b.disabled,
    ),
  );
  for (let i = 0; i < 100 && !(await scriptAction.isDisabled()); i++)
    await guest.waitForTimeout(50);
  assert(
    await scriptAction.isDisabled(),
    'managed scripts receive live revocation',
  );
  await editor.reload();
  await editor.getByRole('button', {name:'Source & models', exact:true}).click();
  await editor.getByLabel('Dataset title', {exact:true}).fill('Updated policy dataset');
  await editor.getByLabel('Save dataset', {exact:true}).click();
  await editor.getByRole('link', {name:'Edit dataset',exact:true}).waitFor();
  await editor.waitForFunction(()=>document.title==='Updated policy dataset');
  assert(!new URL(editor.url()).pathname.endsWith('/edit'));
  console.log(
    'all good: public declared insert, denied deletion/direct SQL, shared live rows, persistence and live revocation',
  );
} finally {
  await browser.close();
  await sink.close();
}
