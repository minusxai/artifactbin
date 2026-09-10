import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startDocument, becomeOwner } from './lib/start-doc.mjs';
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
  markup: `<Helmet><Value name="branch" default="new branch"/><Query name="tree">{\`select * from ref_${dataset.id}\`}</Query><Mutation name="append">{\`insert into ref_${dataset.id} values ($branch)\`}</Mutation><Mutation name="delete">{\`delete from ref_${dataset.id}\`}</Mutation></Helmet><h1>Shared policy tree</h1><Button run="$append">Append branch</Button><Button run="$delete">Delete tree</Button><DataTable data="$tree"/><Iframe title="Policy action" height={80}><button id="action" disabled>Script append</button><script>{\`const action=document.getElementById('action');const sync=()=>{action.disabled=!mx.canMutate('append');};mx.data.subscribe(sync);sync();action.onclick=()=>mx.mutate('append');\`}</script></Iframe>`,
});
const browser = await chromium.launch();
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
  await owner.goto(dataset.url);
  await owner
    .getByRole('button', { name: 'Open artifact controls', exact: true })
    .click();
  await owner.getByRole('button', { name: 'Share', exact: true }).click();
  await owner
    .getByRole('button', { name: 'Manage access policies', exact: true })
    .click();
  await owner.getByLabel('Enable write policies').check();
  await owner.getByLabel('Allow public mutations').check();
  await owner.getByLabel('Allow insert', { exact: true }).check();
  await owner
    .getByRole('button', { name: 'Save access policies', exact: true })
    .click();
  await owner.getByText('Access policies saved.', { exact: true }).waitFor();
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
    .getByRole('button', { name: 'Script append', exact: true });
  await scriptAction.waitFor();
  await guest.waitForFunction(() => true);
  for (let i = 0; i < 100 && (await scriptAction.isDisabled()); i++)
    await guest.waitForTimeout(50);
  assert(
    !(await scriptAction.isDisabled()),
    'managed scripts receive the public grant',
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
    body: JSON.stringify({ sql: `delete from ref_${dataset.id}` }),
  });
  assert(
    raw.status >= 400,
    'editor without a matching policy cannot bypass it',
  );
  await owner.getByLabel('Allow public mutations').uncheck();
  await owner
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
  console.log(
    'all good: public declared insert, denied deletion/direct SQL, shared live rows, persistence and live revocation',
  );
} finally {
  await browser.close();
}
