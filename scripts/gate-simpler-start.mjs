/**
 * Gate: the one-line handoff, end to end, the way it is actually used.
 *
 * A human clicks "create" and pastes ONE LINE containing the token — no
 * start link. An owner can re-arm the separate start-link flow with that token;
 * an agent GETs the resulting link (instructions), POSTs it (a token, once),
 * and edits; the human's page updates live. This gate drives every leg in a
 * real browser + real HTTP, and the negative space too: the paste carries no
 * start link, an unfurler's GET spends nothing, a replayed claim gets 410,
 * and "copy again" revives a dead link.
 *
 *   usage: node scripts/gate-simpler-start.mjs [base]
 */
import { chromium } from 'playwright';

const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { const line = `${c ? '  ok ' : 'FAIL'} ${l}`; out.push(line); console.log(line); return c; };

// ── 1. the human's leg: create from the home page, read the copied prompt ──
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
await page.goto(`${B}/`, { waitUntil: 'load' });
// The homepage folds this behind the "connect an agent" card, whose panel
// carries the button that mints the document and copies the paste-string.
await page.click('[aria-label="Connect an agent"]', { timeout: 30_000 });
await page.click('[aria-label="Create a live document for my agent"]', { timeout: 30_000 });
await page.waitForTimeout(1500);
const prompt = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');

const paste = /\/a\/([A-Za-z0-9]+) using this token: (mx_[A-Za-z0-9_-]+)/.exec(prompt);
ok(!!paste, 'the copied paste carries the bearer token inline');
ok(!/\/start\?k=/.test(prompt), 'and carries no start link');
ok(prompt.length < 160 && !prompt.includes('\n'), `and is one short line (${prompt.length} chars)`);
if (!paste) { console.log('cannot continue without the inline token'); process.exit(1); }
const [, id, pasteToken] = paste;

// The start-link protocol remains independently live: a bearer re-arms it.
const armed = await fetch(`${B}/a/${id}/start`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${pasteToken}` },
});
const armedBody = await armed.json();
const m = /\/a\/([A-Za-z0-9]+)\/start\?k=([A-Za-z0-9_-]+)/.exec(armedBody.prompt ?? '');
ok(armed.status === 200 && m?.[1] === id, 'the bearer re-arm door mints a start link');
if (!m) { console.log('cannot continue without the re-armed link'); process.exit(1); }
const [, , k] = m;
const startUrl = `${B}/a/${id}/start?k=${k}`;

// ── 2. the unfurler: GET spends nothing and reveals nothing ─────────────────
const unfurl1 = await fetch(startUrl);
const unfurl2 = await fetch(startUrl);
const briefText = await unfurl1.text();
ok(unfurl1.status === 200 && unfurl2.status === 200, 'GET is non-consuming (two reads, both 200)');
ok(!/mx_[A-Za-z0-9_-]{20,}/.test(briefText), 'the brief contains no real token');
ok(briefText.includes('/docs') && /POST/.test(briefText), 'the brief teaches the claim and the docs');

// ── 3. the agent's leg: claim, then edit; the human's page updates live ────
await page.goto(`${B}/a/${id}`, { waitUntil: 'load' });
const claim = await fetch(startUrl, { method: 'POST' });
const { token } = await claim.json();
ok(claim.status === 200 && /^mx_/.test(token ?? ''), 'POST claims a working-shaped token');

const put = await fetch(`${B}/api/artifacts/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    title: 'gate doc',
    markup: '<div data-design="tw" className="p-10"><h1 className="text-4xl font-bold">Landed by the agent</h1></div>',
    theme: 'modernist',
  }),
});
ok(put.status === 200, `the claimed token edits (PUT ${put.status})`);

// The page the human is staring at picks the edit up over the live stream.
// The document is an opaque-origin frame, so it is READ through the frame API
// (contentDocument is null across origins by design — that is the sandbox).
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
    const f = await (await p.$('iframe[title="artifact"]').catch(() => null))?.contentFrame();
    const body = f
      ? await f.evaluate('document.body.innerText').catch(() => '')
      : await p.evaluate('document.body.innerText').catch(() => '');
    if (body.includes(text)) return true;
    await p.waitForTimeout(500);
  }
  return false;
};
ok(await seenInFrame(page, 'Landed by the agent'), "the watching human's page updated live");

// ── 4. the link is spent: claim replay and brief both answer 410 ────────────
ok((await fetch(startUrl, { method: 'POST' })).status === 410, 'a replayed claim answers 410');
ok((await fetch(startUrl)).status === 410, 'and the brief for a spent link answers 410');

// ── 5. copy again: the owner re-arms the link with their own token ──────────
const reissue = await fetch(`${B}/a/${id}/start`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
});
const re = await reissue.json();
const m2 = /\/start\?k=([A-Za-z0-9_-]+)/.exec(re.prompt ?? '');
ok(reissue.status === 200 && !!m2, 'an owner re-issue mints a fresh link');
ok((await fetch(`${B}/a/${id}/start?k=${m2?.[1]}`)).status === 200, 'and the fresh link is live');

// ── 6. the GET-only client (ChatGPT's envelope): chunk, finish, published ───
// Simulated the way ChatGPT actually fetches: bare GETs, no headers, no
// method choice, every URL under the ~1.4KB reliable bound.
{
  const { gzipSync } = await import('zlib');
  const startRes = await fetch(`${B}/api/start`, { method: 'POST' });
  const st = await startRes.json();
  const secondToken = typeof st.token === 'string' && /^mx_[A-Za-z0-9_-]+$/.test(st.token) ? st.token : null;
  const secondArm = secondToken ? await fetch(`${B}/a/${st.id}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secondToken}` },
  }) : null;
  const secondArmBody = secondArm ? await secondArm.json() : {};
  const gm = /\/a\/([A-Za-z0-9]+)\/start\?k=([A-Za-z0-9_-]+)/.exec(secondArmBody.prompt ?? '');
  ok(startRes.ok && secondArm?.status === 200 && !!gm, 'a second start re-arms a link for the GET-only leg');
  const [, gid, gk] = gm ?? [, '', ''];
  const gUrl = `${B}/a/${gid}/start?k=${gk}`;

  // Big enough that gzip+base64url spans SEVERAL chunks — a one-chunk pass
  // would leave the assembly path untested. Varied text so gzip can't crush it.
  const paras = Array.from({ length: 40 }, (_, i) =>
    `<p className="mt-3">Section ${i}: ${Math.sin(i).toString(36).slice(2, 14)} measured against quarter ${i % 4 + 1} with drift ${((i * 37) % 100)}%.</p>`).join('');
  const SOURCE = '<div data-design="tw" className="p-10">'
    + '<h1 className="text-4xl font-bold">Written by GET alone</h1>'
    + '<p className="mt-4 text-lg">No POST, no headers, chunked URL fetches.</p>' + paras + '</div>';
  const b64 = gzipSync(Buffer.from(SOURCE, 'utf8')).toString('base64url');
  const pieces = [];
  for (let i = 0; i < b64.length; i += 900) pieces.push(b64.slice(i, i + 900));

  let allStored = true;
  let maxLen = 0;
  for (const [i, d] of pieces.entries()) {
    const u = `${gUrl}&i=${i}&d=${encodeURIComponent(d)}`;
    maxLen = Math.max(maxLen, u.length);
    const r = await fetch(u);
    allStored = allStored && r.status === 200;
  }
  ok(allStored, `all ${pieces.length} chunk GETs stored (200)`);
  ok(maxLen <= 1400, `every chunk URL fits ChatGPT's reliable bound (longest ${maxLen} ≤ 1400)`);

  const done = await fetch(`${gUrl}&done=1&n=${pieces.length}`);
  const doneText = await done.text();
  ok(done.status === 200 && doneText.includes(`/a/${gid}`), `done publishes and returns the link (${done.status})`);

  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page2.goto(`${B}/a/${gid}`, { waitUntil: 'networkidle' });
  ok(await seenInFrame(page2, 'Written by GET alone'), 'the GET-only document renders for a reader');
  await page2.close();

  const replay = await fetch(`${gUrl}&done=1&n=${pieces.length}`);
  ok(replay.status === 410 && (await replay.text()).includes(`/a/${gid}`),
    'a replayed done answers 410 and still names the document URL');
}

await browser.close();

const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} FAILED` : `\nall ${out.length} checks passed`);
process.exit(failed ? 1 : 0);
