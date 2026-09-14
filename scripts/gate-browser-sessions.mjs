/** Live Linux worker gate: real CLI, real artifact runtime, and OS containment. CI only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { connectAgent } from './lib/cli-connection.mjs';

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
const ids = [];
try {
  const markup = count => `<Helmet><Value name="count" type="number" default={${count}}/><Query name="result">{\`select $count as n\`}</Query></Helmet><h1>Session counter</h1><Number data="$result" col="n"/><Iframe title="Counter widget" height={120}><button id="add">Add one</button><p id="value">Waiting</p><script>{\`const stop=mx.subscribe(['count'],s=>document.getElementById('value').textContent=String(s.signals.count.value));document.getElementById('add').onclick=async()=>{const s=await mx.read(['count']);await mx.set({count:s.signals.count.value+1})};addEventListener('pagehide',stop);\`}</script></Iframe>`;
  const artifacts = [];
  for (const count of [1, 7]) {
    const response = await fetch(`${base}/api/artifacts`, { method: 'POST', headers, body: JSON.stringify({ markup: markup(count) }) });
    const artifact = await response.json(); assert(artifact.id, JSON.stringify(artifact)); artifacts.push(artifact.id);
  }
  const first = await cli(['script', 'new'], `
    const opened = await Promise.all(${JSON.stringify(artifacts)}.map(async id => {
      const page = await context.newPage(); await page.goto('/a/'+id);
      await page.waitForFunction(() => Boolean(window.mx));
      return page;
    }));
    await opened[0].evaluate(() => window.mx.set({count:3}));
    const states = await Promise.all(opened.map(page => page.evaluate(() => window.mx.read(['count','result'],{wait:true}))));
    await output.image(await opened[0].screenshot());
    return states;
  `);
  assert.equal(first.status, 'completed', JSON.stringify(first)); ids.push(first.session_id);
  assert.equal(first.pages.length, 2); assert.equal(first.attachments[0].mime, 'image/png');
  assert.deepEqual(first.result.map(s => s.signals.count.value), [3,7]);
  const pageId = first.pages.find(page => page.artifact_id === artifacts[0]).page_id;
  const resumed = await cli(['script', first.session_id], `
    const page = pages[${JSON.stringify(pageId)}];
    const widget = page.frameLocator('iframe[title="Counter widget"]').frameLocator('iframe');
    await widget.getByRole('button',{name:'Add one'}).click();
    await page.waitForFunction(() => window.mx.read(['count']).then(s => s.signals.count.value===4));
    return await page.evaluate(() => window.mx.read(['count']));
  `);
  assert.equal(resumed.status, 'completed', JSON.stringify(resumed)); assert.equal(resumed.result.signals.count.value,4);
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
  assert.deepEqual(probe.result, {checkout:false,network:false,own:'ok',credentials:[]},JSON.stringify(probe));
  const stranger = (await connectAgent(base)).token;
  assert.equal((await request({op:'status',session_id:first.session_id},stranger)).error.code,'SESSION_NOT_FOUND');
  const receipt = await cli(['status',first.session_id,'--execution',resumed.execution_id]);
  assert.deepEqual(receipt.result,resumed.result);
  const lost = await cli(['script', first.session_id], 'while(true) {}');
  assert.equal(lost.status,'lost',JSON.stringify(lost)); assert.equal(lost.error.code,'SESSION_LOST');
  const refused = await cli(['script',first.session_id],'return 1');
  assert.equal(refused.error.code,'SESSION_LOST');
  console.log('browser-sessions: multi-artifact, iframe/API parity, resume, image, errors, receipt recovery, ownership, filesystem/network containment, and hard deadline passed');
} finally {
  for (const session_id of ids) await request({op:'close',session_id}).catch(() => {});
  await rm(scratch,{recursive:true,force:true});
}
