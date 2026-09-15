/**
 * Gate: the one-line handoff, end to end, the way it is actually used.
 *
 * The workshop copies setup instructions. The guide creates a document and
 * copies one line naming the document and the afbin CLI. There is no credential in the paste, none in
 * the response, and no second door that hands one out: the CLI's browser
 * approval is the only way a client is connected. This gate drives that in a
 * real browser + real HTTP, and the negative space too: the start-link
 * protocol and the public mint are GONE, and the page a human is staring at
 * still fills in live when the connected agent writes.
 *
 *   usage: node scripts/gate-simpler-start.mjs [base]
 */
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { chromium } from 'playwright';
import { connectAgent } from './lib/cli-connection.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('simpler-start');

// ── 1. the human's leg: workshop instructions → setup guide → document ──
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
await page.goto(`${B}/`, { waitUntil: 'load' });
const workshop = page.getByRole('region', { name: 'The artifactbin workshop', exact: true });
await workshop.getByRole('button', { name: 'Create Artifact — copy agent instructions', exact: true }).click();
const setupPrompt = `Help me create an artifact with artifactbin. Read ${new URL(B).origin}/docs-human for setup, then ask me what I want to make.`;
await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), setupPrompt);
check(await page.evaluate(() => navigator.clipboard.readText()) === setupPrompt, 'the workshop copies deployment-aware setup instructions');
await workshop.getByRole('link', { name: 'Setup guide ↗', exact: true }).click();
await page.waitForURL(`${B}/docs-human`);
const create = page.getByRole('button', { name: 'Create a live document for my agent', exact: true });
await create.waitFor();
const startRespP = page.waitForResponse(
  (r) => r.url().includes('/api/start') && r.request().method() === 'POST',
  { timeout: 30_000 },
);
await create.click();
const startRes = await startRespP;
const started = await startRes.json();
await page.waitForFunction(id => navigator.clipboard.readText().then(text => text.includes(`/a/${id}`)), started.id);
const prompt = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');

const id = started.id;
check(!!id, 'the create button makes a real document');
check(!('token' in started) && !('expiresAt' in started), 'and the API body hands out NO credential and no expiry');
check(!/mx_/.test(JSON.stringify(started)), 'nothing token-shaped rides the response at all');
check(!(await startRes.allHeaders())['set-cookie'], 'and no agent cookie is set');
// The COPIED paste is tokenless and points at afbin — the agent-facing surface carries no secret.
check(/\/a\/[A-Za-z0-9]+/.test(prompt), 'the copied paste names the artifact URL');
check(!/mx_[A-Za-z0-9_-]+/.test(prompt), 'and carries NO token inline (afbin authenticates itself)');
check(!/\/start\?k=/.test(prompt), 'and carries no start link');
check(prompt.length < 300 && !prompt.includes('\n'), `and is one short line (${prompt.length} chars)`);
check(prompt.includes('afbin'), 'the paste points to the afbin CLI (afbin authenticates itself; no setup step)');
check(prompt.includes('/chat/install.sh'), 'and says how to get it when it is not installed');
if (!id) { console.log('cannot continue without the doc id'); process.exit(1); }

// ── 2. the retired doors are GONE, not merely unadvertised ──────────────────
check((await fetch(`${B}/a/${id}/start?k=anything`)).status === 404, 'the start-link brief is gone (404)');
check((await fetch(`${B}/a/${id}/start`, { method: 'POST' })).status === 404, 'and so is its claim door');
check((await fetch(`${B}/api/tokens/anonymous`, { method: 'POST' })).status === 404,
  'and the public anonymous mint is not a route any more');

// ── 3. the agent's leg: connect the way afbin does, then write ──────────────
// The create button is the PAGE's door (browser_only), so a bare agent posting
// it is refused and told to run afbin — while the CLI's own approval is the
// one way it gets a credential at all.
check((await fetch(`${B}/api/start`, { method: 'POST' })).status === 403,
  'a client that is not the page is refused the create button');
// The start door is the thing under test, so this gate cannot use the shared
// start helper — it walks the same two steps by hand.
const agent = await connectAgent(B);
check(/^mx_/.test(agent.token ?? ''), 'the CLI device approval is the only way a credential exists');
const agentDoc = await (await fetch(`${B}/api/start`, {
  method: 'POST',
  headers: { origin: new URL(B).origin, 'sec-fetch-site': 'same-origin', authorization: `Bearer ${agent.token}` },
})).json();
check(!!agentDoc.id, 'and the connected agent has a document it can write');

await page.goto(`${B}/a/${agentDoc.id}`, { waitUntil: 'load' });
const put = await fetch(`${B}/api/artifacts/${agentDoc.id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.token}` },
  body: JSON.stringify({
    title: 'gate doc',
    markup: '<div data-design="tw" className="p-10"><h1 className="text-4xl font-bold">Landed by the agent</h1></div>',
    theme: 'modernist',
  }),
});
check(put.status === 200, `the connection edits what it created (PUT ${put.status})`);

/**
 * Is this text on screen, wherever the document happens to be?
 *
 * Two shapes, one question. An OWNER sees the document inside the shell's
 * frame; a READER is served the document itself, top-level, at the same URL —
 * so a check that only looked inside a frame would report "not rendered" for
 * exactly the viewer this gate cares about.
 */
const seenInFrame = async (p, text) => {
  for (let i = 0; i < 60; i++) {
    // A no-runtime document RELOADS to show a live update, which destroys the
    // execution context mid-poll: that is the update arriving, not a failure.
    const body = await p.locator('[data-mx-inline-story]').innerText().catch(() => '');
    if (body.includes(text)) return true;
    await p.waitForTimeout(500);
  }
  return false;
};
check(await seenInFrame(page, 'Landed by the agent'), "the watching human's page updated live");

await browser.close();

check.done();
