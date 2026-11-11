/**
 * Gate: A DOCUMENT'S DISCUSSION IN ANOTHER SHELL — a custom shell (APP__SHELL_FILE, scripts/fixtures/host-shell.html) on
 * the app's origin mounts a document with `/af/host.js` and `comments: true`, and gets the app's own reader chrome for it
 * (lib/html-reader/host-shell, solid/document/browser-host-comments). Three accounts, each in its own browser context:
 *
 *   1. Alice (the owner) selects words in the framed document: the frame's selection toolbar offers Comment; her
 *      comment is saved, the passage is pinned and the shell's count says 1;
 *   2. Bob (a commenter through the link), who had the page open, sees the count arrive without a reload, opens the
 *      rail in the shell's panel, reads Alice's thread and replies; Alice, rail closed, is told of one unread thread;
 *   3. Alice resolves it from her rail; Bob's count goes back to 0, live;
 *   4. Carol, signed in on a document whose link grants viewing only, selects and right-clicks: no actions are offered;
 *   5. the rail wears the shell's theme tokens, light and dark.
 *
 * Boots its own production server (dist/server.mjs, `npm run build` first) with the fixture shell, unless the base it is
 * handed already serves pages and that shell.
 *
 *   node scripts/gates/gate-host-comments.mjs [base]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/browser.mjs';
import { pagesServer } from './lib/pages-server.mjs';
import { signInAccount } from './lib/account-connection.mjs';
import { createChecker } from './lib/assert.mjs';
import { sleep } from './lib/sleep.mjs';
import { startMailSink } from '../lib/mail-login.mjs';

const SHELL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/host-shell.html');
const check = createChecker('host-comments');
const stamp = Date.now().toString(36);
const isShell = async (base) => (await fetch(`${base}/a/none`).then((r) => r.text()).catch(() => '')).includes('window.hostEvents');
const server = await pagesServer(process.argv[2], 'host-comments', { env: { APP__SHELL_FILE: SHELL }, drives: isShell });
const BASE = server.app;
check.note(`server ${server.booted ? 'booted' : 'driven'} at ${BASE}`);

async function until(read, want, budgetMs = 15_000) {
  const end = Date.now() + budgetMs;
  let value;
  do { value = await read().catch(() => undefined); if (want(value)) return value; await sleep(100); } while (Date.now() < end);
  return value;
}
const sink = await startMailSink();
const account = (who) => signInAccount(BASE, { sink, email: `mxmx_test_host_comments_${who}_${stamp}@example.com` });
const [alice, bob, carol] = await Promise.all([account('alice'), account('bob'), account('carol')]);
const send = async (cookie, method, route, body) => {
  const response = await fetch(`${BASE}${route}`, { method, headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${method} ${route} → ${response.status} ${await response.text()}`);
  return response.json();
};
const page = (title, words) => `<!doctype html><html><head><title>${title}</title></head><body style="font:18px/1.6 sans-serif;padding:32px"><h1 data-af-id="title">${title}</h1><p data-af-id="p1">${words}</p></body></html>`;
const publish = async (title, words, linkRole) => {
  const { id } = await send(alice.cookie, 'POST', '/api/my/artifacts', { title, html: page(title, words) });
  await send(alice.cookie, 'PUT', `/api/my/artifacts/${id}/sharing`, { visibility: 'public', linkRole });
  return id;
};
const finance = await publish('Finance', 'Revenue grew forty percent in the third quarter.', 'commenter');
const memo = await publish('Memo', 'Headcount stays flat through the winter.', 'viewer');

const browser = await launchChromium();
const open = async ({ cookie }, id, viewport = { width: 1280, height: 800 }) => {
  const context = await browser.newContext({ viewport });
  await context.addCookies(cookie.split('; ').map((pair) => { const at = pair.indexOf('='); return { name: pair.slice(0, at), value: pair.slice(at + 1), url: BASE }; }));
  const tab = await context.newPage();
  tab.on('pageerror', (error) => check.note(`page error: ${error.message}`));
  await tab.goto(`${BASE}/a/${id}`);
  const frame = tab.frameLocator('#doc iframe');
  await frame.locator('[data-af-id="p1"]').waitFor({ timeout: 30_000 });
  await tab.waitForFunction(() => window.hostEvents?.some((event) => event.name === 'af-document-comments'), null, { timeout: 30_000 });
  return { tab, frame };
};
const counts = (tab) => tab.evaluate(() => window.hostEvents.filter((event) => event.name === 'af-document-comments').at(-1)?.detail);
/** Drag across the paragraph's first words, as a reader does. */
async function selectWords(tab, frame) {
  const box = await frame.locator('[data-af-id="p1"]').boundingBox();
  await tab.mouse.move(box.x + 4, box.y + box.height / 2);
  await tab.mouse.down();
  await tab.mouse.move(box.x + 190, box.y + box.height / 2, { steps: 8 });
  await tab.mouse.up();
}
const toolbar = (frame) => frame.locator('[data-mx-selection-actions]');

try {
  const A = await open(alice, finance);
  const B = await open(bob, finance);
  check((await counts(B.tab))?.open === 0, 'Bob opens the story in the shell: no comments yet');

  // 1. Alice selects and comments.
  await selectWords(A.tab, A.frame);
  check(await toolbar(A.frame).waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), 'selecting words in the frame offers the selection toolbar');
  check(await A.frame.locator('[data-mx-selection-action="annotate"]').isVisible(), 'the toolbar offers Comment to the owner');
  await A.frame.locator('[data-mx-selection-action="annotate"]').click();
  const composer = A.tab.getByRole('textbox', { name: /comment/i }).first();
  await composer.waitFor({ timeout: 10_000 });
  await A.tab.keyboard.type('Is this forty or forty-one?');
  await A.tab.keyboard.press('ControlOrMeta+Enter');
  check((await until(() => counts(A.tab), (c) => c?.open === 1))?.open === 1, 'the comment is saved and the shell\'s count says 1');
  const thread = await A.tab.evaluate(() => window.hostEvents.find((event) => event.name === 'af-document-thread' && event.detail.id)?.detail.id);
  check(typeof thread === 'string', `the shell is told which thread opened (${thread})`);
  // The frame paints the commented words (its annotation overlay: a highlight or marks, lib/html-bridge/annotations).
  check(await until(() => A.frame.locator('[data-af="annotation-overlay"]').evaluate((overlay) => overlay.childElementCount), (n) => n > 0) > 0, 'the commented passage is painted in the frame');
  check(await A.tab.getByRole('button', { name: /^Open annotation conversation by .*, 1 message$/ }).first().waitFor({ timeout: 10_000 }).then(() => true, () => false), 'its mark sits at the frame\'s edge, drawn by the module over the shell');

  // 2. Bob sees it live, opens the rail in the shell's panel and replies.
  check((await until(() => counts(B.tab), (c) => c?.open === 1))?.open === 1, 'Bob\'s count goes to 1 without a reload');
  await B.tab.click('#comments');
  const panel = B.tab.locator('#panel');
  const rail = panel.getByLabel('Annotation sidebar', { exact: true });
  check(await rail.waitFor({ timeout: 10_000 }).then(() => true, () => false), 'the comments rail opens inside the shell\'s panel');
  check(await rail.getByText('Is this forty or forty-one?').isVisible(), 'Bob reads Alice\'s comment there');
  await rail.getByLabel('Open annotation thread').first().click();
  const reply = rail.getByRole('textbox', { name: 'Reply to annotation', exact: true }).first();
  await reply.waitFor({ timeout: 10_000 });
  await reply.fill('Forty-one, per the ledger.');
  await rail.getByRole('button', { name: 'Send reply', exact: true }).click();
  check(await until(() => A.tab.evaluate(() => window.hostEvents.filter((event) => event.name === 'af-document-comments').at(-1)?.detail.unread), (n) => n === 1) === 1, 'Alice, rail closed, is told of one thread with news');

  // 3. Alice resolves from her rail; Bob's count follows.
  await A.tab.click('#comments');
  const aliceRail = A.tab.locator('#panel').getByLabel('Annotation sidebar', { exact: true });
  await aliceRail.getByLabel('Open annotation thread').first().click();
  check(await aliceRail.getByText('Forty-one, per the ledger.').waitFor({ timeout: 10_000 }).then(() => true, () => false), 'Alice reads Bob\'s reply in her rail');
  check((await counts(A.tab))?.unread === 0, 'opening the rail clears the unread count');
  // Light and dark, in the shell's palette: the rail's ground is the shell's `--card`/`--background`, not the app's.
  const ground = () => aliceRail.evaluate((node) => getComputedStyle(node).backgroundColor);
  const light = await ground();
  await A.tab.click('#mode');
  const dark = await until(ground, (value) => value && value !== light, 5000);
  check(light === 'rgb(247, 243, 234)' || light === 'rgb(255, 250, 240)', `the rail wears the shell's light tokens (${light})`);
  check(dark === 'rgb(23, 18, 13)' || dark === 'rgb(34, 26, 18)', `and its dark ones (${dark})`);
  await A.tab.click('#mode');
  await aliceRail.getByLabel('Resolve annotation').first().click();
  check((await until(() => counts(B.tab), (c) => c?.open === 0))?.open === 0, 'Alice resolves it; Bob\'s count goes back to 0, live');

  // 4. A viewer is offered nothing.
  const C = await open(carol, memo);
  // The owner's toolbar showed within moments of her drag: give the viewer's as long, polling, before saying none came.
  const offered = () => until(() => toolbar(C.frame).isVisible(), (shown) => shown === true, 2000);
  await selectWords(C.tab, C.frame);
  check(await offered() !== true, 'a signed-in viewer selecting words gets no selection toolbar');
  await C.frame.locator('[data-af-id="title"]').click({ button: 'right' });
  check(await offered() !== true, 'nor a context menu of actions');
} finally {
  await browser.close();
  server.stop();
}
check.done();
