/**
 * Gate: the DATA journey as a person actually walks it.
 *
 * Written after a screenshot showed a dataset page rendering column headers and
 * zero rows — the page read `content`, which is empty now that rows live in the
 * object store. Every check here is a fault that shipped or nearly did: an
 * empty table, an "edit" button on a file you cannot edit, a blank cell
 * indistinguishable from an empty string.
 *
 * The upload FORM is signed-in-only now (the anonymous next-steps rail
 * deliberately offers browse/log-in instead — components/NextSteps.tsx), and
 * the form itself is unit-tested in dataset-upload.ui.test.tsx. So the dataset
 * here is created over the API: the same ingest pipeline the form posts to,
 * which keeps every rendering check below honest.
 *
 *   usage: node scripts/gate-data-ux.mjs [base]
 */
import { chromium } from 'playwright';
import { openArtifactControls, openMenu } from './lib/reveal-chrome.mjs';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';
import { mintAnon } from './lib/mint-anon.mjs';
const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { out.push(`${c ? '  ok ' : 'FAIL'} ${l}`); return c; };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
await p.goto(B, { waitUntil: 'load' });
await p.evaluate(() => localStorage.clear());

// ── a CSV with a typed name, through the same ingest the form posts to ──────
const tok = (await mintAnon(B)).token;
// A browser's credential is the httpOnly session cookie now, not a
// localStorage token — and the shell it unlocks belongs to the owner.
await becomeOwner(p, B, tok);
const csv = 'month,revenue,zip,note\n2026-01,120,01234,ok\n2026-02,,09876,\n2026-03,190,01234,fine';
const made = await (await fetch(`${B}/api/artifacts`, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
  body: JSON.stringify({ title: 'Q3 Revenue', dataset: csv }) })).json();
ok(!!made.id, `the dataset lands with a usable reference (${made.ref})`);

// ── the dataset PAGE: the bug from the screenshot ───────────────────────────
await p.goto(`${B}/a/${made.id}`, { waitUntil: 'load' });
await p.waitForTimeout(2500);
const rows = await p.locator('table tbody tr').count();
ok(rows === 3, `the dataset page renders ROWS, not just headers (${rows})`);
ok((await p.locator('[aria-label="Dataset summary"]').textContent()).includes('3 rows'), 'and says how many rows and columns');
const tableText = await p.locator('table').innerText();
ok(tableText.includes('—'), 'a blank cell reads as missing, not as empty text');
ok(tableText.includes('01234'), 'leading zero preserved through ingest');
ok((await p.locator('[aria-label="Edit artifact"]').count()) === 0, 'no edit button on a dataset');
await openMenu(p);
ok((await p.locator('[aria-label="Current page"]').textContent()).includes('Q3 Revenue'), 'the menu carries the typed title as page context');
await p.keyboard.press('Escape');
const w = await p.evaluate(() => ({ d: document.documentElement.scrollWidth, w: window.innerWidth }));
ok(w.d <= w.w, 'no horizontal page scroll');
await p.screenshot({ path: '/tmp/ux-dataset.png' });

// ── a chart must render in EDIT mode too ───────────────────────────────────
// View mode resolves refs on the server; the editor resolves them client-side
// through /api/artifacts/:id. When rows moved to the object store the editor's
// copy kept reading the (now empty) content column, so every chart said "data
// unavailable" the moment you pressed edit — while view mode looked perfect.
{
  const st = await startDocument(B); // the token rides the start LINK now
  const ds = await fetch(`${B}/api/artifacts`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
    body: JSON.stringify({ title: 'edit-mode data', dataset: 'region,revenue\nNorth,4200\nSouth,3100' }) }).then((r) => r.json());
  const mk = `<Helmet><Query name="rows">{\`select * from ref_${ds.id}\`}</Query></Helmet><div data-design="tw" className="@container p-8"><h1 className="text-3xl font-bold">Rev</h1><Question title="Revenue" data="$rows" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region","type":"nominal"},"y":{"field":"revenue","type":"quantitative"}}}}} height="430px" /></div>`;
  await fetch(`${B}/api/artifacts/${st.id}`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
    body: JSON.stringify({ title: 'Rev', markup: mk, theme: 'manuscript' }) });
  await p.goto(`${B}/a/${st.id}`, { waitUntil: 'load' });
  // A browser's credential is the httpOnly session cookie now, not a
// localStorage token — and the shell it unlocks belongs to the owner.
await becomeOwner(p, B, st.token);
  await p.goto(`${B}/a/${st.id}#edit`, { waitUntil: 'commit' });
  let sawUnavailable = false;
  for (let i = 0; i < 70; i++) {
    await p.waitForTimeout(150);
    const fr = p.frames().find((x) => x !== p.mainFrame());
    const txt = fr ? await fr.locator('body').innerText().catch(() => '') : '';
    if (/data unavailable/.test(txt)) sawUnavailable = true;
    if (fr && (await fr.locator('svg.marks, canvas').count().catch(() => 0))) break;
  }
  const ef = p.frames().find((x) => x !== p.mainFrame());
  const marks = ef ? await ef.locator('svg.marks, canvas').count().catch(() => 0) : 0;
  const text = ef ? await ef.locator('body').innerText().catch(() => '') : '';
  ok(marks > 0, `a chart renders in EDIT mode (${marks} marks)`);
  ok(!/data unavailable/.test(text), 'and does not say "data unavailable"');
  // The failure message must never appear even for a frame while refs load —
  // "did not resolve" is a verdict, and it is wrong while a fetch is in flight.
  ok(!sawUnavailable, 'and never flashed the failure message while loading');
}

// ── a markup artifact still HAS an edit button — for its OWNER ──────────────
// The anonymous-owner path: the /start token is exchanged for the httpOnly
// session cookie exactly as AgentLink's flow does, and the edit affordance
// must then reveal itself. A reader, meanwhile, is not shown chrome — they are
// served the document itself, which has no app chrome at all.
const st = await startDocument(B);
const readerCtx = await p.context().browser().newContext();
const readerPage = await readerCtx.newPage();
await readerPage.goto(`${B}/a/${st.id}`, { waitUntil: 'load' });
ok((await readerPage.locator('[aria-label="Edit this document"], [aria-label="Edit artifact"]').count()) === 0, 'a reader sees no edit chrome');
await readerCtx.close();
// A browser's credential is the httpOnly session cookie now, not a
// localStorage token — and the shell it unlocks belongs to the owner.
await becomeOwner(p, B, st.token);
await p.goto(`${B}/a/${st.id}`, { waitUntil: 'load' });
await p.waitForTimeout(2500);
await openArtifactControls(p);
ok((await p.locator('[aria-label="Edit this document"], [aria-label="Edit artifact"]').count()) >= 1, 'a document still offers edit to its owner');

// (The upload form's error paths — bad URL, private sheet — are exercised at
// the API level in gate-data-ingest and at the component level in
// dataset-upload.ui.test.tsx; the form no longer exists signed-out.)

console.log(out.join('\n'));
await b.close();
process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
