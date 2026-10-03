/** Live Linux worker gate: real CLI, real artifact runtime, and OS containment. CI only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { connectAgent } from './lib/cli-connection.mjs';
import { containmentExpectation, containmentObserved } from './lib/session-containment.mjs';

const base = process.argv[2] ?? 'http://localhost:3030';
const token = (await connectAgent(base)).token;
const scratch = await mkdtemp(path.join(tmpdir(), 'afbin-sessions-gate-'));
const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const request = async (body, credential = token) => {
  const response = await fetch(`${base}/api/browser-sessions`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${credential}` }, body: JSON.stringify(body) });
  assert.equal(response.status, 200); return response.json();
};
const cli = async (args, code) => {
  const file = path.join(scratch, `${randomUUID()}.js`);
  if (code !== undefined) await writeFile(file, code);
  const child = spawn(process.execPath, ['services/cli/dist/afbin.mjs', 'sessions', ...args, ...(code === undefined ? [] : ['--input', file]), '--server', base, '--json'], {
    env: { ...process.env, ARTIFACTBIN_TOKEN: token, ARTIFACTBIN_URL: base, HOME: scratch }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  let result;
  try { result = JSON.parse(stdout); } catch { throw new Error(`Invalid CLI output: ${stderr.slice(-1000)}`); }
  return result;
};
const evidence = path.resolve('tmp/browser-session-evidence');
await mkdir(evidence, {recursive:true});
const saveImage = async (name, attachment) => {
  const bytes = Buffer.from(attachment.base64, 'base64');
  assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  await writeFile(path.join(evidence, name+'.png'), bytes);
};
const ids = [];
/** Which of the probe's four facts this host can be asked about; see lib/session-containment.mjs. */
let skipped = [];
try {
  // The counter's own Helmet script renders the count through an effect over the `count` signal; the session
  // drives the very same signal through `window.page`.
  const counterScript = [
    "import { count } from 'page';",
    "import { effect } from '@preact/signals';",
    "effect(() => { document.getElementById('value').textContent = String(count.value); });",
    "document.getElementById('add').addEventListener('click', () => { count.value = count.value + 1; });",
  ].join('\n');
  const markup = count => '<Helmet><Value name="count" type="number" default={' + count + '}/><Query name="result">{`select $count as n`}</Query><script>{' + JSON.stringify(counterScript) + '}</script></Helmet><h1>Session counter</h1><Number data="$result" col="n"/><button id="add">Add one</button><p id="value">Waiting</p>';
  const artifacts = [];
  for (const count of [1, 7]) {
    const response = await fetch(`${base}/api/artifacts`, { method: 'POST', headers, body: JSON.stringify({ markup: markup(count) }) });
    const artifact = await response.json(); assert(artifact.id, JSON.stringify(artifact)); artifacts.push(artifact.id);
  }
  const first = await cli(['script', 'new'], `
    const opened = await Promise.all(${JSON.stringify(artifacts)}.map(async id => {
      const page = await context.newPage(); await page.goto('/a/'+id);
      await page.locator('#value').filter({hasText:/^[0-9]+$/}).waitFor();
      await page.waitForFunction(() => Boolean(window.page));
      return page;
    }));
    await opened[0].evaluate(() => { window.page.value('count').value = 3; });
    await opened[0].locator('#value').filter({hasText:/^3$/}).waitFor();
    const states = await Promise.all(opened.map(page => page.evaluate(async () => ({
      count: window.page.value('count').value,
      result: await window.page.query('result').ready,
      shown: document.getElementById('value').textContent,
    }))));
    await output.image(await opened[0].screenshot());
    return states;
  `);
  assert.equal(first.status, 'completed', JSON.stringify(first)); ids.push(first.session_id);
  assert.equal(first.pages.length, 2); assert.equal(first.attachments[0].mime, 'image/png');
  await saveImage('counter', first.attachments[0]);
  assert.deepEqual(first.result.map(s => s.count), [3,7], JSON.stringify(first.result));
  assert.deepEqual(first.result.map(s => s.shown), ['3','7'], 'the page script rendered the signal the session set');
  assert.deepEqual(first.result.map(s => s.result.map(row => row.n)), [[3],[7]], 'the dependent query re-ran for the set value');
  const pageId = first.pages.find(page => page.artifact_id === artifacts[0]).page_id;
  const resumed = await cli(['script', first.session_id], `
    const page = pages[${JSON.stringify(pageId)}];
    await page.getByRole('button',{name:'Add one'}).click();
    await page.locator('#value').filter({hasText:/^4$/}).waitFor();
    return await page.evaluate(() => ({ count: window.page.value('count').value }));
  `);
  assert.equal(resumed.status, 'completed', JSON.stringify(resumed)); assert.equal(resumed.result.count,4);
  assert(resumed.pages.some(page => page.page_id === pageId));
  const failure = await cli(['script', first.session_id], 'throw new Error("intentional failure");');
  assert.equal(failure.status,'failed'); assert.equal(failure.pages.length,2);
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
  assert.deepEqual(containmentObserved(probe.result, containment.expected), containment.expected, JSON.stringify(probe));
  const stranger = (await connectAgent(base)).token;
  assert.equal((await request({op:'status',session_id:first.session_id},stranger)).error.code,'SESSION_NOT_FOUND');
  const receipt = await cli(['status',first.session_id,'--execution',resumed.execution_id]);
  assert.deepEqual(receipt.result,resumed.result);
  const lost = await cli(['script', first.session_id], 'while(true) {}');
  assert.equal(lost.status,'lost',JSON.stringify(lost)); assert.equal(lost.error.code,'SESSION_LOST');
  const refused = await cli(['script',first.session_id],'return 1');
  assert.equal(refused.error.code,'SESSION_LOST');
  // An agent-shaped widget: the page's own script builds the controls and renders through `effect`, and a
  // session drives the same names through `window.page` — the two must agree in both directions.
  const widgetScript = [
    "import { region, sales, addTask } from 'page';",
    "import { effect } from '@preact/signals';",
    "const host = document.getElementById('agent-widget');",
    "const regionEl = document.createElement('select'); regionEl.setAttribute('aria-label', 'Region');",
    "for (const name of ['East', 'West']) { const option = document.createElement('option'); option.value = name; option.textContent = name; regionEl.append(option); }",
    "const table = document.createElement('table'); const rowsEl = document.createElement('tbody'); table.append(rowsEl);",
    "const labelEl = document.createElement('input'); labelEl.setAttribute('aria-label', 'Task title');",
    "const addBtn = document.createElement('button'); addBtn.textContent = 'Add task';",
    "const errorEl = document.createElement('p');",
    "host.replaceChildren(regionEl, table, labelEl, addBtn, errorEl);",
    "effect(() => { if (regionEl.value !== String(region.value)) regionEl.value = String(region.value); });",
    "effect(() => {",
    "  rowsEl.replaceChildren(...sales.value.map(row => { const tr = document.createElement('tr'); for (const v of [row.name, row.revenue]) { const td = document.createElement('td'); td.textContent = String(v); tr.append(td); } return tr; }));",
    "  errorEl.textContent = sales.error.value ?? '';",
    "});",
    "regionEl.addEventListener('change', () => { region.value = regionEl.value; });",
    "addBtn.addEventListener('click', async () => {",
    "  const title = labelEl.value.trim(); if (!title) return;",
    "  addBtn.disabled = true;",
    "  try { await addTask({ taskTitle: title }); } catch (error) { errorEl.textContent = error.message; } finally { addBtn.disabled = false; }",
    "});",
  ].join('\n');
  const agentMarkup = '<Helmet><Value name="region" default="East"/><Value name="taskTitle" default="untouched"/><Value name="tasks" type="table" value={[{title:"Existing"}]}/><Query name="sales">{`select $region || \' total\' as name, case when $region=\'West\' then 200 else 100 end as revenue`}</Query><Mutation name="addTask">{`insert into tasks (title) values ($taskTitle)`}</Mutation><script>{'+JSON.stringify(widgetScript)+'}</script></Helmet><h1>Agent transfer fixture</h1><div id="agent-widget">Loading widget</div>';
  const published = await fetch(`${base}/api/artifacts`, {method:'POST',headers,body:JSON.stringify({markup:agentMarkup})});
  const agentArtifact = await published.json(); assert(agentArtifact.id,JSON.stringify(agentArtifact));
  const opened = await cli(['script','new'],`
    const page = await context.newPage(); await page.goto(${JSON.stringify('/a/')}+${JSON.stringify(agentArtifact.id)});
    await page.getByLabel('Region').waitFor();
    await page.waitForFunction(() => Boolean(window.page));
    return await page.evaluate(() => ({ region: window.page.value('region').value, sales: window.page.query('sales').value, tasks: window.page.query('tasks').value }));
  `); ids.push(opened.session_id);
  assert.equal(opened.status,'completed',JSON.stringify(opened));
  assert.equal(opened.result.region,'East');
  assert.deepEqual(opened.result.tasks.map(row=>row.title),['Existing']);
  const agentPageId = opened.pages[0].page_id;
  const mutated = await cli(['script',opened.session_id],`
    const page = pages[${JSON.stringify(agentPageId)}];
    return await page.evaluate(async () => {
      await window.page.mutation('addTask')({ taskTitle: 'Session task' });
      return { tasks: await window.page.query('tasks').ready, taskTitle: window.page.value('taskTitle').value };
    });
  `);
  assert.equal(mutated.status,'completed',JSON.stringify(mutated));
  assert.equal(mutated.result.taskTitle,'untouched','a mutation argument applies to that call only');
  assert(mutated.result.tasks.some(row=>row.title==='Session task'),JSON.stringify(mutated.result));
  const widget = await cli(['script',opened.session_id],`
    const page = pages[${JSON.stringify(agentPageId)}];
    await page.getByLabel('Region').selectOption('West');
    await page.getByText('West total',{exact:true}).waitFor();
    await page.evaluate(() => { window.page.value('region').value = 'East'; });
    await page.getByText('East total',{exact:true}).waitFor();
    if (await page.getByLabel('Region').inputValue()!=='East') throw new Error('Page selection did not synchronize');
    await page.getByLabel('Task title').fill('Widget task');
    await page.getByRole('button',{name:'Add task'}).click();
    await page.waitForFunction(() => window.page.query('tasks').value.some(row => row.title === 'Widget task'), null, { timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector('#agent-widget button').disabled, null, { timeout: 5000 });
    await output.image(await page.screenshot());
    return await page.evaluate(() => ({ region: window.page.value('region').value, taskTitle: window.page.value('taskTitle').value, tasks: window.page.query('tasks').value.map(row => row.title) }));
  `);
  assert.equal(widget.status,'completed',JSON.stringify(widget));
  assert.equal(widget.result.taskTitle,'untouched');
  assert.equal(widget.result.region,'East');
  assert.deepEqual(widget.result.tasks,['Existing','Session task','Widget task']);
  assert.equal(widget.attachments.length,1);
  await saveImage('page-widget', widget.attachments[0]);
  console.log(`browser-sessions: multi-artifact, page script/window.page parity, resume, image, errors, receipt recovery, ownership, ${skipped.length ? 'credential-free worker environment' : 'filesystem/network containment'}, and hard deadline passed`);
  if (skipped.length) console.log(`browser-sessions: SKIPPED on this host (server reports sandbox: none): ${skipped.join(', ')} — Linux CI asserts them.`);
} finally {
  for (const session_id of ids) await request({op:'close',session_id}).catch(() => {});
  await rm(scratch,{recursive:true,force:true});
}
