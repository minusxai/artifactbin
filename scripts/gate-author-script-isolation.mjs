/** Built-server security acceptance: authored JS has data capabilities, never renderer/account authority. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mintAnon } from './lib/mint-anon.mjs';
import { becomeOwner } from './lib/start-doc.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5400';
const token = await mintAnon(base);
async function api(path, method, body) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert(response.ok, `${method} ${path}: ${response.status} ${response.ok ? '' : await response.text()}`);
  return response.json();
}
const script = `
  try { parent.document.querySelector('h1').textContent='ESCAPED'; mx.params.set('dom','escaped'); }
  catch(e) { mx.params.set('dom',e.name); }
  try { localStorage.getItem('secret'); mx.params.set('storage','escaped'); }
  catch(e) { mx.params.set('storage',e.name); }
  fetch('https://example.com/exfil').then(()=>mx.params.set('network','escaped'),()=>mx.params.set('network','blocked'));
  for (const kind of ['like','follow','edit']) top.postMessage({type:'mx:reader-action',kind},'*');
  top.postMessage({type:'mx:text-edit',path:'0',nonce:'guessed',innerHtml:'FORGED'},'*');
  mx.mutate('undeclared').then(()=>mx.params.set('mutation','escaped'),()=>mx.params.set('mutation','refused'));
  mx.params.subscribe(values=>{ if (values.output !== values.input * 2) mx.params.set('output',values.input * 2); });
  mx.params.set('input',3);
`;
const markup = code => `<Helmet>
  <Value name="dom" type="string" default="waiting" /><Value name="storage" type="string" default="waiting" />
  <Value name="network" type="string" default="waiting" /><Value name="mutation" type="string" default="waiting" />
  <Value name="input" type="number" default={0} /><Value name="output" type="number" default={0} />
  <Query name="probe">{\`select $dom as dom, $storage as storage, $network as network, $mutation as mutation, $output as output\`}</Query>
  <script>{\`${code}\`}</script></Helmet><h1 id="heading">Script boundary</h1><DataTable data="$probe" />`;
const doc = await api('/api/artifacts','POST',{title:'mxmx_test_script_isolation',markup:markup(script)});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await becomeOwner(page,base,token.token);
  const accountRequests = [];
  page.on('request',r=>{ if (/\/(like|follow|edits|annotations)(?:\?|$)/.test(new URL(r.url()).pathname) && r.method() !== 'GET') accountRequests.push(r.url()); });
  await page.goto(`${base}/a/${doc.id}`);
  const frame = await (await page.waitForSelector('iframe[title="artifact"]')).contentFrame();
  await frame.waitForFunction(()=>{
    const values=window.mx?.params;
    return values?.get('dom')==='SecurityError' && values.get('storage')==='SecurityError'
      && values.get('network')==='blocked' && values.get('mutation')==='refused' && values.get('output')===6;
  }).catch(async error => { console.error('isolation state', await frame.evaluate(()=>window.mx?.params ? ['dom','storage','network','mutation','input','output'].map(n=>[n,window.mx.params.get(n)]) : 'no mx')); throw error; });
  assert.equal(await frame.locator('#heading').textContent(),'Script boundary');
  assert.equal(await frame.locator('iframe[title="Isolated artifact script"]').getAttribute('sandbox'),'allow-scripts');
  assert.deepEqual(accountRequests,[],'author messages must not invoke account APIs');
  assert.equal((await api(`/api/artifacts/${doc.id}`,'GET')).version,1,'author cannot edit source');
  // A changed script replaces its old realm, and a removed script revokes it.
  const before = await frame.locator('iframe[title="Isolated artifact script"]').elementHandle();
  await api(`/api/artifacts/${doc.id}`,'PUT',{markup:markup("mx.params.set('output',77)")});
  await frame.waitForFunction(()=>window.mx?.params.get('output')===77);
  assert.equal(await before.evaluate(el=>el.isConnected),false);
  await api(`/api/artifacts/${doc.id}`,'PUT',{markup:'<h1 id="heading">Script removed</h1><Card>Still interactive</Card>'});
  await frame.waitForFunction(()=>document.querySelector('#heading')?.textContent==='Script removed');
  assert.equal(await frame.locator('iframe[title="Isolated artifact script"]').count(),0);
  await page.reload();
  const reloaded = await (await page.waitForSelector('iframe[title="artifact"]')).contentFrame();
  await reloaded.waitForFunction(()=>document.querySelector('#heading')?.textContent==='Script removed');
  assert.equal(await reloaded.locator('iframe[title="Isolated artifact script"]').count(),0);
  console.log('PASS: opaque script DOM/storage/network isolation, signals, mutation refusal, forged account/edit denial, live replacement/removal, reload');
} finally {
  await browser.close();
  await api(`/api/artifacts/${doc.id}`,'DELETE');
}
