/**
 * Gate: the one-line handoff, end to end, the way it is actually used.
 *
 * A human clicks "create" and copies ONE LINE that names the document and the
 * afbin CLI — and nothing else. There is no credential in the paste, none in
 * the response, and no second door that hands one out: the CLI's browser
 * approval is the only way a client is connected. This gate drives that in a
 * real browser + real HTTP, and the negative space too: the start-link
 * protocol and the public mint are GONE, and the page a human is staring at
 * still fills in live when the connected agent writes.
 *
 *   usage: node scripts/gate-simpler-start.mjs [base]
 */
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { chromium } from 'playwright';
import { startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { const line = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(line); console.log(line); return c; };

// ── 1. the human's leg: create from the home page, read the copied prompt ──
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
await page.goto(`${B}/`, { waitUntil: 'load' });
// The home page has two shapes and the create button sits at a different depth
// in each: a stranger gets the LANDING page, which offers it outright, while a
// browser already holding drafts gets the shelf, where it is folded behind the
// "connect an agent" card. Wait for either, and open the card only when that
// is the one on screen.
await page.waitForSelector(
  '[aria-label="Create a live document for my agent"], [aria-label="Connect an agent"]',
  { timeout: 30_000 },
);
if (!(await page.locator('[aria-label="Create a live document for my agent"]').count())) {
  await page.click('[aria-label="Connect an agent"]', { timeout: 30_000 });
}
const startRespP = page.waitForResponse(
  (r) => r.url().includes('/api/start') && r.request().method() === 'POST',
  { timeout: 30_000 },
);
await page.click('[aria-label="Create a live document for my agent"]', { timeout: 30_000 });
const startRes = await startRespP;
const started = await startRes.json();
await page.waitForTimeout(1500);
const prompt = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');

const id = started.id;
ok(!!id, 'the create button makes a real document');
ok(!('token' in started) && !('expiresAt' in started), 'and the API body hands out NO credential and no expiry');
ok(!/mx_/.test(JSON.stringify(started)), 'nothing token-shaped rides the response at all');
ok(!(await startRes.allHeaders())['set-cookie'], 'and no agent cookie is set');
// The COPIED paste is tokenless and points at afbin — the agent-facing surface carries no secret.
ok(/\/a\/[A-Za-z0-9]+/.test(prompt), 'the copied paste names the artifact URL');
ok(!/mx_[A-Za-z0-9_-]+/.test(prompt), 'and carries NO token inline (afbin authenticates itself)');
ok(!/\/start\?k=/.test(prompt), 'and carries no start link');
ok(prompt.length < 300 && !prompt.includes('\n'), `and is one short line (${prompt.length} chars)`);
ok(prompt.includes('afbin'), 'the paste points to the afbin CLI (afbin authenticates itself; no setup step)');
ok(prompt.includes('/chat/install.sh'), 'and says how to get it when it is not installed');
if (!id) { console.log('cannot continue without the doc id'); process.exit(1); }

// ── 2. the retired doors are GONE, not merely unadvertised ──────────────────
ok((await fetch(`${B}/a/${id}/start?k=anything`)).status === 404, 'the start-link brief is gone (404)');
ok((await fetch(`${B}/a/${id}/start`, { method: 'POST' })).status === 404, 'and so is its claim door');
ok((await fetch(`${B}/api/tokens/anonymous`, { method: 'POST' })).status === 404,
  'and the public anonymous mint is not a route any more');

// ── 3. the agent's leg: connect the way afbin does, then write ──────────────
// The create button is the PAGE's door (browser_only), so a bare agent posting
// it is refused and told to run afbin — while the CLI's own approval is the
// one way it gets a credential at all.
ok((await fetch(`${B}/api/start`, { method: 'POST' })).status === 403,
  'a client that is not the page is refused the create button');
const agentDoc = await startDocument(B);
ok(/^mx_/.test(agentDoc.token ?? ''), 'the CLI device approval is the only way a credential exists');
ok(!!agentDoc.id, 'and the connected agent has a document it can write');

await page.goto(`${B}/a/${agentDoc.id}`, { waitUntil: 'load' });
const put = await fetch(`${B}/api/artifacts/${agentDoc.id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentDoc.token}` },
  body: JSON.stringify({
    title: 'gate doc',
    markup: '<div data-design="tw" className="p-10"><h1 className="text-4xl font-bold">Landed by the agent</h1></div>',
    theme: 'modernist',
  }),
});
ok(put.status === 200, `the connection edits what it created (PUT ${put.status})`);

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
ok(await seenInFrame(page, 'Landed by the agent'), "the watching human's page updated live");

await browser.close();

const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} FAILED` : `\nall ${out.length} checks passed`);
process.exit(failed ? 1 : 0);
