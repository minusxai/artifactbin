import { artifactDocument } from './lib/artifact-document.mjs';
/**
 * Gate: reactive JSX, document-local SQL, and Dialog over both document
 * transports. Local state belongs to one loaded document: it may travel to the
 * query/mutation routes, but it never becomes an artifact or dataset write.
 *
 * usage: node scripts/gate-local-sql-state.mjs [base]
 */
import { chromium } from 'playwright';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';
import { mintAnon } from './lib/mint-anon.mjs';

export const timeoutMs = 90_000;
const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (condition, label) => { out.push(`${condition ? '  ok ' : 'FAIL'} ${label}`); return condition; };
const json = async response => { const text = await response.text(); try { return JSON.parse(text); } catch { return {raw:text}; } };
const token = (await mintAnon(B)).token;
const headers = {Authorization:`Bearer ${token}`, 'Content-Type':'application/json'};
const api = (path, body) => fetch(`${B}${path}`, {method:'POST', headers, body:JSON.stringify(body)});

const dataset = await json(await api('/api/artifacts', {dataset:[{id:1, label:'stored'}], access:'readwrite'}));
const source = `<Helmet>
  <Value name="count" type="number" default={0} />
  <Value name="open" type="boolean" default={false} />
  <Value name="note" type="string" default="draft" />
  <Value name="choice" type="string" default="a" />
  <Value name="drafts" type="table" value={[{"id":1,"label":"first"}]} />
  <Query name="draft_count">{\`select count(*) n from drafts\`}</Query>
  <Mutation name="add_draft">{\`insert into drafts values ((select coalesce(max(id),0)+1 from drafts), $note)\`}</Mutation>
  <Mutation name="increment">{\`update _signals set count=count+1\`}</Mutation>
</Helmet>
<main data-design="tw" className="@container p-8">
  <select aria-label="Choice" value="$choice" options={["a","b"]} />
  <p aria-label="Count">{$count}</p>
  <p aria-label="Rows"><Number data="$draft_count" col="n" /></p>
  {$count > 0 && <p aria-label="Positive">positive</p>}
  {$choice === "b" ? <p aria-label="Branch">bee</p> : <p aria-label="Branch">aye</p>}
  <Button aria-label="Add draft" run="$add_draft">Add draft</Button>
  <Dialog open="$open">
    <DialogTrigger aria-label="Open dialog">Open dialog</DialogTrigger>
    <DialogContent aria-label="Draft dialog" run="$increment">
      <input aria-label="Note" value="$note" required autoFocus />
      <button aria-label="Save dialog" type="submit">Save</button>
      <DialogClose aria-label="Close dialog">Cancel</DialogClose>
    </DialogContent>
  </Dialog>
</main>`;
const doc = await json(await api('/api/artifacts', {markup:source, visibility:'unlisted'}));
const aclDoc = await json(await api('/api/artifacts', {markup:`<Helmet><Mutation name="stored_write">{\`insert into ref_${dataset.id} (id, label) values (2, 'forbidden')\`}</Mutation></Helmet><Button run="$stored_write">Write</Button>`, visibility:'unlisted'}));
ok(!!dataset.id && !!doc.id && !!aclDoc.id, `fixtures published (${dataset.id}, ${doc.id})`);
if (!dataset.id || !doc.id || !aclDoc.id) throw new Error(`fixture publish failed: ${JSON.stringify({dataset, doc, aclDoc})}`);

const browser = await chromium.launch();
const sink = await startMailSink();
try {
const exercise = async (page, framed, documentId) => {
  const routeBodies = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes(`/a/${documentId}/`)) {
      try { routeBodies.push({url:request.url(), body:request.postDataJSON()}); } catch {}
    }
  });
  await page.goto(`${B}/a/${documentId}?$choice=b`, {waitUntil:'load'});
  const frame = framed ? await artifactDocument(page) : page.mainFrame();
  await frame.waitForFunction(() => document.querySelector('[aria-label="Rows"]')?.textContent?.trim() === '1', null, {timeout:20_000}).catch(async error => {
    throw new Error(`${error.message}; page=${(await frame.locator('body').innerText()).slice(0, 1000)}`);
  });
  ok((await frame.textContent('[aria-label="Branch"]')) === 'bee', `${framed ? 'framed' : 'top-level'} URL scalar seeds the ternary`);
  await frame.click('[aria-label="Add draft"]');
  await frame.waitForFunction(() => document.querySelector('[aria-label="Rows"]')?.textContent?.trim() === '2');
  await frame.click('[aria-label="Add draft"]');
  await frame.waitForFunction(() => document.querySelector('[aria-label="Rows"]')?.textContent?.trim() === '3');
  ok(true, `${framed ? 'relayed' : 'direct'} repeated local table edits feed the dependent query`);
  await frame.click('[aria-label="Open dialog"]');
  ok(await frame.locator('[aria-label="Draft dialog"]').evaluate(el => el.open) && await frame.locator('[aria-label="Note"]').evaluate(el => el === document.activeElement), 'Dialog opens and focuses its field');
  await frame.fill('[aria-label="Note"]', 'changed');
  const validity = await frame.locator('[aria-label="Draft dialog"]').evaluate(dialog => {
    const field = dialog.querySelector('[aria-label="Note"]');
    const submit = dialog.querySelector('[aria-label="Save dialog"]');
    const form = dialog.querySelector('form');
    return {value:field.value, disabled:field.disabled, fieldsetDisabled:dialog.querySelector('fieldset').disabled, valid:field.validity.valid, formValid:form.checkValidity(), submitDisabled:submit.disabled, submitType:submit.type, associated:submit.form === form, contentEditable:submit.contentEditable, picking:document.documentElement.getAttribute('data-mx-annotate-picking'), status:dialog.querySelector('[role="status"]')?.textContent ?? null};
  });
  ok(validity.value === 'changed' && !validity.disabled && validity.valid && validity.formValid && !validity.submitDisabled,
    `Dialog field is filled, enabled, and valid before submit (${JSON.stringify(validity)})`);
  await frame.click('[aria-label="Save dialog"]');
  await frame.waitForFunction(() => document.querySelector('[aria-label="Count"]')?.textContent === '1', null, {timeout:15_000});
  ok((await frame.locator('[aria-label="Draft dialog"]').evaluate(el => el.open)) === false && (await frame.textContent('[aria-label="Positive"]')) === 'positive', 'submit closes Dialog and _signals drives && rendering');
  ok(await frame.locator('[aria-label="Open dialog"]').evaluate(el => el === document.activeElement), 'successful submit restores focus to the trigger');
  await frame.click('[aria-label="Open dialog"]');
  await frame.press('[aria-label="Note"]', 'Escape');
  await frame.waitForFunction(() => !document.querySelector('[aria-label="Draft dialog"]')?.open);
  ok(await frame.locator('[aria-label="Open dialog"]').evaluate(el => el === document.activeElement), 'Escape closes Dialog and restores focus');
  const snapshots = routeBodies.filter(call => call.body?.localTables && Object.keys(call.body.localTables).length);
  ok(snapshots.some(call => call.url.endsWith('/mutate')) && snapshots.some(call => call.url.endsWith('/query')), `${framed ? 'relayed' : 'direct'} mutation and query snapshots reached their routes`);
  await page.waitForFunction(() => new URLSearchParams(location.search).get('$count') === '1', null, {timeout:5_000});
  await page.reload({waitUntil:'load'});
  const reloaded = framed ? await artifactDocument(page) : page.mainFrame();
  await reloaded.waitForFunction(() => document.querySelector('[aria-label="Rows"]')?.textContent?.trim() === '1', null, {timeout:20_000});
  ok((await reloaded.textContent('[aria-label="Count"]')) === '1' && (await reloaded.textContent('[aria-label="Branch"]')) === 'bee', 'reload resets local rows while URL scalar changes persist');
};

const anonymous = await browser.newPage();
ok((await anonymous.goto(`${B}/a/${doc.id}`, {waitUntil:'load'})).status() === 200 && await anonymous.locator('iframe[title="artifact"]').count() === 0, 'anonymous public document is top-level');
await exercise(anonymous, false, doc.id);

const ownerContext = await browser.newContext();
const owner = await ownerContext.newPage();
await loginViaEmail(owner, B, sink, `mxmx_test_local_state_${Date.now().toString(36)}@example.com`);
ok((await owner.evaluate(async t => (await fetch('/api/tokens/claim', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token:t})})).status, token)) === 200, 'owner claimed the publishing token');
const privateDoc = await json(await api('/api/artifacts', {markup:source, visibility:'private'}));
if (!privateDoc.id) throw new Error(`private fixture publish failed: ${JSON.stringify(privateDoc)}`);
ok((await owner.evaluate(async id => (await fetch(`/api/my/artifacts/${id}/sharing`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({access:'read'})})).status, dataset.id)) === 200, 'stored dataset was made read-only');
await exercise(owner, true, privateDoc.id);

const afterDoc = await json(await fetch(`${B}/api/artifacts/${doc.id}`, {headers}));
const afterDataset = await json(await fetch(`${B}/api/artifacts/${dataset.id}`, {headers}));
ok(afterDoc.version === doc.version, `local edits did not bump the source version (${afterDoc.version})`);
ok(afterDataset.access === 'read' && afterDataset.rowCount === 1, 'local edits did not change stored dataset rows or permissions');
const forbidden = await api(`/a/${aclDoc.id}/mutate`, {mutation:'stored_write', values:{}});
ok(forbidden.status === 403, `persistent dataset mutation remains ACL-protected (${forbidden.status})`);

ok((await fetch(`${B}/a/${privateDoc.id}`)).status === 404 && (await fetch(`${B}/a/${privateDoc.id}/query`, {method:'POST', headers:{'Content-Type':'text/plain'}, body:'{}'})).status === 404, 'private document and its data route cannot be fetched anonymously');

await ownerContext.close(); await anonymous.close();
} finally {
  sink.close();
  await browser.close();
}
console.log(out.join('\n'));
const failed = out.filter(line => line.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
