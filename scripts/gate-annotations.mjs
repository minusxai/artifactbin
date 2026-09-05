/**
 * Gate: ANNOTATIONS — the owner pins feedback to a node, the agent answers.
 *
 * The loop no unit test can make, because every seam is a browser fact: the
 * owner selects text INSIDE the sandboxed frame, the composer is PAGE chrome
 * fed by that report, the tint is a real element the frame renders, and the
 * agent's HTTP resolve must reach the still-open tab over the live stream and
 * take it with it — no reload anywhere. Commenting is a LAYER: no mode is
 * entered anywhere in this gate, the rail is a panel, and the loop that used to
 * need four navigations (done → annotate → done → edit) is one toolbar click
 * inside the editor — with the typing before it surviving, which is the one
 * thing here that can lose someone's work. A logged-out context then proves a reader
 * sees none of it (they get the bare document, which carries no pins and no
 * chrome at all) — including the view-mode SELECTION BUBBLE, which is browser
 * fact all the way down: a Selection inside an opaque frame, chrome the frame
 * draws against it, and a capability only the page may grant.
 *
 *   usage: node scripts/gate-annotations.mjs [base]
 */
import { chromium } from 'playwright';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const failures = [];
const ok = (pass, label) => { console.log(`${pass ? '  ok ' : 'FAIL '} ${label}`); if (!pass) failures.push(label); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(read, want, budgetMs = 8000) {
  const deadline = Date.now() + budgetMs;
  let last;
  while (Date.now() < deadline) {
    last = await read().catch(() => undefined);
    if (want(last)) return last;
    await sleep(200);
  }
  return last;
}

const DOC =
  '<Helmet><title>Annotated</title></Helmet>'
  + '<div data-design="tw" className="p-10">'
  + '<h1>Quarterly report</h1>'
  + '<p id="intro">An intro paragraph of ordinary prose.</p>'
  // Nested on purpose: a breadcrumb only offers non-root ancestors, so the
  // section is what proves the crumb renders and re-targets.
  + '<section className="max-w-2xl"><p id="figure">Revenue grew 40% in Q3.</p></section>'
  + '</div>';

const run = async () => {
  const { id, token } = await startDocument(BASE);
  const put = await fetch(`${BASE}/api/artifacts/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ markup: DOC }),
  });
  if (!put.ok) throw new Error(`publish failed (${put.status}): ${await put.text()}`);

  const browser = await chromium.launch();
  try {
    // ── the owner's tab ────────────────────────────────────────────────────
    const owner = await browser.newContext();
    const page = await owner.newPage();
    await becomeOwner(page, BASE, token);
    await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
    const frame = page.frameLocator('iframe[title="artifact"]');
    await frame.locator('#figure').waitFor({ timeout: 15000 });

    // ── the view-mode selection bubble ────────────────────────────────────
    // Highlighting words offers the next move WHERE THE WORDS ARE: inside the
    // frame, because only the document can see a Selection at an opaque origin.
    // Clicked-until-it-takes for the same reason as the node click below — the
    // capability grant and the lazy chunk land a beat after the page does.
    const bubble = frame.locator('[data-mx-selection-actions]');
    await until(async () => {
      await frame.locator('#figure').click({ clickCount: 3, timeout: 2000 }).catch(() => {});
      return bubble.isVisible().catch(() => false);
    }, (v) => v === true, 15000);
    ok(await bubble.isVisible(), 'selecting text in view mode raises the action bubble inside the document');
    ok(await frame.locator('[aria-label="Edit selected text"]').count() === 1
      && await frame.locator('[aria-label="Comment on selected text"]').count() === 1,
      'the owner is offered both edit and annotate');

    // Choosing Annotate opens the composer on those exact words — and enters
    // NOTHING. Commenting is a layer, so no hash moves and no mode opens.
    await frame.locator('[aria-label="Comment on selected text"]').click();
    const seeded = await until(() => page.locator('[aria-label="Annotation comment"]').count(), (n) => n === 1, 10000);
    ok(seeded === 1, 'the composer opens on the selected words — no second click on the same text');
    ok(await page.evaluate(() => location.hash) === '', 'commenting enters no mode: the hash is untouched');
    ok(await frame.locator('#figure[data-mx-annotate-selected]').count() === 1,
      'the frame marks the node the composer is composing on');
    ok(await page.locator('[aria-label="Select section"]').count() >= 1, 'the composer carries the selection breadcrumb');

    // Write it from the composer the bubble opened.
    await page.locator('[aria-label="Annotation comment"]').fill('this number looks wrong — check the Q3 sheet');
    await page.locator('[aria-label="Save annotation"]').click();

    // Saving tints the commented node (the Docs highlight).
    const highlighted = frame.locator('#figure[data-mx-annotated]');
    await highlighted.waitFor({ timeout: 8000 });
    ok(true, 'saving tints the commented node');

    // ── the rail is a PANEL, not a mode ───────────────────────────────────
    await openArtifactControls(page);
    await page.locator('[aria-label="Toggle comments"]').click();
    await page.locator('[aria-label="Annotation sidebar"]').waitFor({ timeout: 8000 });
    ok(await page.evaluate(() => location.hash) === '', 'opening the rail moves no hash');
    await openArtifactControls(page);
    ok(await page.locator('[aria-label="Edit artifact"]').count() === 1, 'edit stays offered while the rail is open');
    await page.keyboard.press('Escape');
    const thread = page.locator('[aria-label="Annotation thread"]');
    ok((await thread.textContent())?.includes('Q3 sheet'), 'the saved comment appears as a rail thread');
    ok(await page.locator('[aria-label="Artifact viewport"]').evaluate((el) => el.style.right !== '0px'),
      'the open rail narrows the document rather than covering it');

    await page.locator('[aria-label="Close comments"]').click();
    const railGone = await until(() => page.locator('[aria-label="Annotation sidebar"]').count(), (n) => n === 0, 5000);
    ok(railGone === 0, 'closing the rail puts the panel away');

    // THE INVERSION: the tint used to leave with the mode. It is ambient now,
    // so it stays — and a compact identity marker floats beside it.
    const stillTinted = await until(() => frame.locator('#figure[data-mx-annotated]').count(), (n) => n === 1, 5000);
    ok(stillTinted === 1, 'the tint is ambient: a commented node stays marked with no rail and no mode');
    ok((await page.locator('[aria-label="Open annotation count"]').textContent()) === '1', 'the comments button carries the unresolved count');
    const viewComments = page.locator('[aria-label="Open annotation comments"]');
    await viewComments.waitFor({ timeout: 8000 });
    const viewComment = page.locator('[aria-label^="Open annotation conversation by"]');
    await viewComment.waitFor({ timeout: 8000 });
    const compactBox = await viewComment.boundingBox();
    ok(!!compactBox && compactBox.width <= 40 && compactBox.height <= 40,
      'the ambient annotation is a compact identity marker');
    ok(await page.locator('[aria-label="Artifact viewport"]').evaluate((el) => (el).style.right === '0px'),
      'the floating marker leaves the document full-width');
    await viewComment.hover();
    const expandedBox = await until(() => viewComment.boundingBox(), (box) => !!box && box.width > 250, 5000);
    ok((await viewComments.textContent())?.includes('Q3 sheet'), 'hover reveals the conversation preview');
    const anchorBox = await frame.locator('#figure').boundingBox();
    const commentBox = expandedBox;
    // The marker follows the WORDS now (F3: a comment keeps its selection, and
    // its rect is the union of the highlighted ranges), so it sits on the text
    // LINE rather than on the paragraph box — half-leading apart, a handful of
    // pixels. It is still the annotated content it follows.
    ok(!!anchorBox && !!commentBox && Math.abs(anchorBox.y - commentBox.y) <= 12,
      `the annotation marker follows its annotated content vertically (${Math.round(Math.abs((anchorBox?.y ?? 0) - (commentBox?.y ?? 0)))}px apart)`);
    const viewportWidth = await page.evaluate(() => innerWidth);
    ok(!!commentBox
      && commentBox.x >= 0
      && commentBox.x + commentBox.width <= viewportWidth
      && Math.abs(viewportWidth - (commentBox.x + commentBox.width) - 12) <= 2,
    'the expanded preview stays fixed to the right and inside the viewport');

    // There is no second visibility state: annotations remain ambient and the
    // artifact controls only open the full rail.
    await page.mouse.move(400, 20);
    await openArtifactControls(page);
    ok(await page.locator('[aria-label="Hide comments"], [aria-label="Show comments"]').count() === 0,
      'artifact controls carry no annotation visibility toggle');
    await page.keyboard.press('Escape');

    // Clicking the compact conversation opens the rail FOCUSED on that thread,
    // ready to continue — a panel, still not a mode.
    await viewComment.click();
    await page.locator('[aria-label="Annotation sidebar"]').waitFor({ timeout: 8000 });
    await frame.locator('#figure[data-mx-annotation-open]').waitFor({ timeout: 8000 });
    ok(await page.evaluate(() => location.hash) === '', 'opening a thread never touches the URL');
    ok((await thread.first().textContent())?.includes('Q3 sheet') && await page.locator('[aria-label="Reply to annotation"]').first().isVisible(),
      'clicking the floating marker opens the rail focused and ready to reply');

    // ── the agent's side, over plain HTTP ─────────────────────────────────
    const wire = await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const ann = wire.annotations?.[0];
    ok(!!ann && ann.snippet.includes('Revenue grew 40%'), 'GET /api/artifacts/<id> inlines the annotation with its snippet');
    ok(wire.open_annotations === 1, 'the wire carries the open count');
    ok(typeof ann?.anchor?.key === 'string' && wire.markup.includes(`data-annotation-anchor="${ann.anchor.key}"`), 'the markup carries only the opaque annotation anchor key');

    // The case the ids exist for: a full-replace PUT that keeps the attribute keeps the annotation.
    const rewritten = wire.markup.replace('grew 40%', 'grew 34%');
    const putRes = await fetch(`${BASE}/api/artifacts/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ markup: rewritten }),
    });
    ok(putRes.ok, 'the agent full-replaces the document, preserving the annotation anchor');
    const afterPut = await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    ok(afterPut.annotations?.[0]?.orphaned === false && afterPut.annotations?.[0]?.snippet.includes('34%'),
      'the annotation survives the PUT and its snippet follows the new text');
    const stillHighlighted = await until(() => frame.locator('#figure[data-mx-annotated]').count(), (n) => n === 1, 10000);
    ok(stillHighlighted === 1, 'the open tab re-highlights the node after the live adopt');

    const resolved = await (await fetch(`${BASE}/api/artifacts/${id}/annotations/${ann.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: 'Recomputed — it was 34%. Fixed.', resolve: true }),
    })).json();
    ok(resolved.status === 'resolved' && resolved.thread?.length === 2, 'the agent replies and resolves in one POST');

    // The still-open owner tab loses the highlight AND the sidebar thread
    // WITHOUT a reload (the live stream); resolved history is listed below it.
    const gone = await until(() => frame.locator('[data-mx-annotated]').count(), (n) => n === 0, 10000);
    ok(gone === 0, 'the resolve reaches the open tab live: the highlight lifts with no reload');
    const threadGone = await until(() => page.locator('[aria-label="Annotation thread"]').count(), (n) => n === 0, 8000);
    ok(threadGone === 0, 'the open-thread list empties live too');
    const badgeGone = await until(() => page.locator('[aria-label="Open annotation count"]').count(), (n) => n === 0, 5000);
    ok(badgeGone === 0, 'the count badge drops with the resolve');
    const resolvedCard = await until(() => page.locator('[aria-label="Resolved annotation thread"]').count(), (n) => n === 1, 8000);
    ok(resolvedCard === 1, 'resolved history lists the closed thread below the open list');

    // The owner's delete erases the thread outright once its collapsed
    // conversation is opened.
    await page.locator('[aria-label="Show resolved conversation"]').click();
    await page.locator('[aria-label="Annotation actions"]').click();
    await page.locator('[aria-label="Delete annotation"]').click();
    const allGone = await until(() => page.locator('[aria-label="Resolved annotation thread"]').count(), (n) => n === 0, 8000);
    ok(allGone === 0, 'delete erases the thread from the history');
    const wireAfter = await (await fetch(`${BASE}/api/artifacts/${id}/annotations?status=all`, { headers: { Authorization: `Bearer ${token}` } })).json();
    ok(wireAfter.annotations?.length === 0, 'the delete reached storage — nothing left on the wire');

    // ── THE POINT OF ALL OF THIS: comment WHILE editing ───────────────────
    // Type into a paragraph, then comment on that same paragraph without
    // leaving edit mode. The comment's anchor is a real CAS edit and the
    // editor answers a 409 by adopting the server's document, so this is
    // exactly where un-drained typing would be thrown away.
    await openArtifactControls(page);
    await page.locator('[aria-label="Edit artifact"]').click();
    await until(() => page.evaluate(() => location.hash), (h) => h === '#edit');
    const editComments = await until(() => page.locator('[aria-label="Toggle comments"]').count(), (n) => n === 1, 5000);
    ok(editComments === 1, 'the comments control survives entering edit mode');

    // Clicked-until-it-takes, like every other in-frame click here: the edit
    // chunk and the frame's re-render after the agent's PUT both land a beat
    // after the mode does, and a click in that beat selects nothing.
    const para = frame.locator('#figure');
    const toolbar = page.locator('[aria-label="Typography toolbar"]');
    await until(async () => {
      await para.click({ timeout: 2000 }).catch(() => {});
      return toolbar.isVisible().catch(() => false);
    }, (v) => v === true, 20000);
    ok(await toolbar.isVisible(), 'the editor selects the annotated paragraph');
    await page.keyboard.press('End');
    await page.keyboard.type(' MIDSENTENCE');

    // The toolbar's Comment button keeps focus in the host on mousedown, so
    // the typing above is still UNCOMMITTED when the composer opens.
    await page.locator('[aria-label="Comment on selection"]').click();
    const editComposer = await until(() => page.locator('[aria-label="Annotation comment"]').count(), (n) => n === 1, 10000);
    ok(editComposer === 1, 'the editor toolbar opens the composer without leaving edit mode');
    ok(await page.evaluate(() => location.hash) === '#edit', 'commenting mid-edit stays in edit mode');
    await page.locator('[aria-label="Annotation comment"]').fill('written without leaving the editor');
    await page.locator('[aria-label="Save annotation"]').click();
    await until(() => page.locator('[aria-label="Annotation comment"]').count(), (n) => n === 0, 10000);

    // BOTH writes survived, in order: the drain landed the keystrokes, then
    // the anchor was stamped against the fresh head.
    const afterMid = await until(
      async () => (await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json()),
      (w) => (w?.annotations?.length ?? 0) === 1,
      15000,
    );
    ok((afterMid?.annotations?.length ?? 0) === 1, 'the mid-edit comment reached storage');
    ok(typeof afterMid?.markup === 'string' && afterMid.markup.includes('MIDSENTENCE'),
      'the typing before it survived: the editor was drained before the anchor was stamped');

    // …and the layer is ambient INSIDE the editor: the node just commented on
    // is tinted while the document is still editable.
    const tintWhileEditing = await until(() => frame.locator('#figure[data-mx-annotated]').count(), (n) => n === 1, 10000);
    ok(tintWhileEditing === 1, 'commented nodes are tinted inside the editor');

    await page.locator('[aria-label="Exit edit mode"]').click();
    await until(() => page.evaluate(() => location.hash), (h) => h === '');

    // ── a logged-out reader sees nothing ──────────────────────────────────
    const strangerCtx = await browser.newContext();
    const stranger = await strangerCtx.newPage();
    await stranger.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
    await sleep(1500);
    const strangerPins = await stranger.locator('[data-mx-annotated], [data-mx-annotation-open]').count();
    const strangerButtons = await stranger.locator('[aria-label="Toggle comments"]').count();
    ok(strangerPins === 0 && strangerButtons === 0, 'a logged-out reader sees no pins and no annotate chrome');
    // A reader is served the document top-level, so their selection happens in
    // the page itself — and nothing grants them an action, so no chunk loads.
    await stranger.locator('#figure').click({ clickCount: 3, timeout: 2000 }).catch(() => {});
    await sleep(500);
    ok(await stranger.locator('[data-mx-selection-actions]').count() === 0,
      'a reader selecting text is offered nothing at all');
    await strangerCtx.close();
    await owner.close();

    // ── the comment keeps the exact selection ─────────────────────────────
    await quoteLeg(browser);
    // ── an agent's reply is READ as markdown ──────────────────────────────
    await markdownLeg(browser);
    // ── a long reply folds; a resolved card reads as resolved ─────────────
    await foldLeg(browser);
  } finally {
    await browser.close();
  }
};

/**
 * A COMMENT KEEPS THE WORDS, NOT JUST THE NODE (F3).
 *
 * Every seam here is browser fact and nothing below the browser can see it: a
 * REAL drag from the middle of one paragraph into the next (a Selection inside
 * an opaque frame), the parts it produces relative to the anchored block, the
 * CSS Custom Highlight API painting them across two paragraphs after a RELOAD
 * — no DOM surgery, so there is no element for a unit test to find — and the
 * fallback to the whole-node tint once an agent writes the words away.
 */
const QUOTE_DOC =
  '<Helmet><title>Quoted</title></Helmet>'
  + '<div data-design="tw" className="p-10">'
  + '<h1>Two paragraphs</h1>'
  + '<p id="first">Revenue grew 40% in Q3, ahead of plan.</p>'
  + '<p id="second">Costs fell 8% over the same period.</p>'
  + '</div>';
const FIRST_TEXT = 'Revenue grew 40% in Q3, ahead of plan.';
const SECOND_TEXT = 'Costs fell 8% over the same period.';

async function quoteLeg(browser) {
  const { id, token } = await startDocument(BASE);
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const published = await fetch(`${BASE}/api/artifacts/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ markup: QUOTE_DOC }) });
  if (!published.ok) throw new Error(`quote leg publish failed (${published.status}): ${await published.text()}`);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await becomeOwner(page, BASE, token);
  await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
  const frame = page.frameLocator('iframe[title="artifact"]');
  await frame.locator('#second').waitFor({ timeout: 15000 });
  const raw = await until(async () => page.frame({ url: (u) => u.pathname.includes('/raw') }), (f) => !!f, 15000);

  /*
   * The drag: from one CHARACTER inside the first paragraph to one inside the
   * second. Aimed by measuring the character rather than by taking a fraction
   * of the element's box — a paragraph's box is the whole column, so 45% of it
   * lands past the end of a short sentence and the drag starts on nothing.
   */
  const frameBox = await page.locator('iframe[title="artifact"]').boundingBox();
  const pointAt = async (selector, index) => {
    const inFrame = await raw.evaluate(([sel, at]) => {
      const range = document.createRange();
      range.setStart(document.querySelector(sel).firstChild, at);
      range.setEnd(document.querySelector(sel).firstChild, at + 1);
      const box = range.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }, [selector, index]);
    return { x: frameBox.x + inFrame.x, y: frameBox.y + inFrame.y };
  };
  const dragAcross = async () => {
    const from = await pointAt('#first', 24);   // inside "ahead of plan."
    const to = await pointAt('#second', 12);    // inside "8% over"
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // A nudge before the long move: press-then-jump is delivered as a CLICK at
    // the destination and selects nothing at all (measured — the drag looked
    // right and the Range came back collapsed at its end point).
    await page.mouse.move(from.x + 6, from.y, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 20 });
    await page.mouse.up();
  };
  const bubble = frame.locator('[data-mx-selection-actions]');
  await until(async () => {
    await dragAcross().catch(() => {});
    return bubble.isVisible().catch(() => false);
  }, (v) => v === true, 20000);
  ok(await bubble.isVisible(), 'a drag across two paragraphs raises the bubble');

  await frame.locator('[aria-label="Comment on selected text"]').click();
  await until(() => page.locator('[aria-label="Annotation comment"]').count(), (n) => n === 1, 10000);
  await page.locator('[aria-label="Annotation comment"]').fill('does this hold for both?');
  await page.locator('[aria-label="Save annotation"]').click();

  // (a) THE WIRE: the quote and a two-part range, the second addressed as the
  // anchor's next sibling — never an absolute path, which would rot.
  const read = async () => (await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json());
  const wire = await until(read, (w) => (w?.annotations?.length ?? 0) === 1, 15000);
  const ann = wire.annotations?.[0];
  const parts = ann?.range?.parts ?? [];
  ok(parts.length === 2 && parts[0].rel === '' && parts[1].rel === '+1',
    `the range is two parts, "" then "+1" (got ${JSON.stringify(parts.map((p) => p.rel))})`);
  ok(FIRST_TEXT.endsWith(parts[0]?.text ?? 'x') && SECOND_TEXT.startsWith(parts[1]?.text ?? 'x'),
    'each part is exactly the run it covers in its own node');
  ok(ann?.quote === `${parts[0]?.text} ${parts[1]?.text}`, 'the quote is the parts, one space between blocks');
  ok(ann?.quote_found === true, 'the quoted words are still in the document');
  ok(ann?.snippet === FIRST_TEXT, 'the snippet is still the whole anchored node — a different thing, kept');

  // (b) THE PAINT, AFTER A RELOAD: nothing about it is stored in the DOM, so a
  // reload is the honest test that the range alone can re-find the words.
  await page.reload({ waitUntil: 'load' });
  const reloaded = await until(async () => page.frame({ url: (u) => u.pathname.includes('/raw') }), (f) => !!f && f !== raw, 15000);
  const paint = await until(
    () => reloaded.evaluate((name) => {
      const highlight = window.CSS?.highlights?.get(name);
      if (!highlight) return { has: false };
      const rects = [...highlight].map((range) => range.getBoundingClientRect());
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const inside = (rect, p) => rect.top >= p.top - 3 && rect.bottom <= p.bottom + 3 && rect.width > 0;
      return {
        has: true,
        count: rects.length,
        first: rects.some((rect) => inside(rect, box('#first'))),
        second: rects.some((rect) => inside(rect, box('#second'))),
        ranged: !!document.querySelector('#first[data-mx-annotation-ranged]'),
      };
    }, `mx-annotation-${ann.id}`).catch(() => ({ has: false })),
    (p) => p?.has === true,
    15000,
  );
  ok(paint.has, 'the frame registers a CSS highlight for the thread after a reload');
  ok(paint.first && paint.second, 'the highlight covers words in BOTH paragraphs');
  ok(paint.ranged, 'the anchored node gives up its own tint while its words are painted');

  // (c) AN AGENT REWORDS THE FIRST PARAGRAPH: the thread stays anchored, the
  // quote no longer reads as it did, and the paint falls back to the tint.
  const current = await read();
  const rewritten = current.markup.replace(FIRST_TEXT, 'Revenue was flat in Q3, behind plan.');
  const put = await fetch(`${BASE}/api/artifacts/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ markup: rewritten }) });
  ok(put.ok, 'the agent rewords the annotated paragraph, keeping the anchor');
  const after = await until(read, (w) => w?.annotations?.[0]?.quote_found === false, 15000);
  ok(after?.annotations?.[0]?.quote_found === false, 'quote_found turns false when the words are written away');
  ok(after?.annotations?.[0]?.orphaned === false, 'the thread is still anchored — the node is still there');
  ok(after?.annotations?.[0]?.quote === ann.quote, 'the quote itself is never recomputed');
  const fallback = await until(
    () => reloaded.evaluate((name) => ({
      highlighted: !!window.CSS?.highlights?.get(name),
      tinted: !!document.querySelector('#first[data-mx-annotated]'),
      ranged: !!document.querySelector('#first[data-mx-annotation-ranged]'),
    }), `mx-annotation-${ann.id}`).catch(() => null),
    (state) => state?.highlighted === false,
    15000,
  );
  ok(fallback?.highlighted === false && fallback?.tinted === true && fallback?.ranged === false,
    `the live frame falls back to the whole-node tint (got ${JSON.stringify(fallback)})`);
  await ctx.close();
}

/**
 * AN AGENT'S REPLY IS PROSE WITH CODE IN IT (F5).
 *
 * The body is plain TEXT on the wire and stays that way — what changed is the
 * READING. Only a browser can show that: the rail renders a real `<pre>` for a
 * fenced block, and it has to arrive over the LIVE annotations stream, with no
 * reload, because the whole point is a comment answered while its reader is
 * looking at it. A collapsed thread would show the plain text, so the thread is
 * opened first: that is the surface under test.
 */
const MD_DOC =
  '<Helmet><title>Markdown comments</title></Helmet>'
  + '<div data-design="tw" className="p-10">'
  + '<h1>The cap</h1>'
  + '<p id="cap">The cap is 5 today.</p>'
  + '</div>';

const AGENT_REPLY = [
  'Fixed in `lib/config.ts` — the cap was **10**:',
  '',
  '```ts',
  'const MAX = 10;',
  '```',
  '',
  '- bumped the cap',
  '- added a test',
].join('\n');

async function markdownLeg(browser) {
  const { id, token } = await startDocument(BASE);
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const published = await fetch(`${BASE}/api/artifacts/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ markup: MD_DOC }) });
  if (!published.ok) throw new Error(`markdown leg publish failed (${published.status}): ${await published.text()}`);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await becomeOwner(page, BASE, token);
  await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
  const frame = page.frameLocator('iframe[title="artifact"]');
  await frame.locator('#cap').waitFor({ timeout: 15000 });

  // The comment itself through the browser door, with the session the page
  // already holds — the selection dance is the leg above's subject, not this
  // one's. `0.1` is the paragraph: BODY paths, the Helmet already hoisted off.
  const head = await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: auth })).json();
  const created = await page.evaluate(async ([docId, editId]) => {
    const res = await fetch(`/api/my/artifacts/${docId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '0.1', edit_id: editId, body: 'why is the cap 5?' }),
    });
    return { status: res.status, body: await res.text() };
  }, [id, head.edit_id]);
  ok(created.status === 201, `the owner leaves a comment (${created.status} ${created.body.slice(0, 120)})`);

  // Open the rail, and open the thread inside it: the compact surfaces show
  // the plain text on purpose, so only the opened thread renders the tree.
  await openArtifactControls(page);
  await page.locator('[aria-label="Toggle comments"]').click();
  await page.locator('[aria-label="Annotation sidebar"]').waitFor({ timeout: 8000 });
  await page.keyboard.press('Escape');
  const thread = page.locator('[aria-label="Annotation thread"]').first();
  await thread.waitFor({ timeout: 8000 });
  await page.locator('[aria-label="Open annotation thread"]').first().click();
  ok(await page.locator('[aria-label="Reply to annotation"]').first().isVisible(), 'the thread opens ready to reply');
  ok(await page.locator('[aria-label="Bold"]').first().isVisible(), 'the reply box carries the markdown toolbar');

  // THE AGENT ANSWERS over plain HTTP, with a fenced block in the reply.
  const wire = await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: auth })).json();
  const ann = wire.annotations?.[0];
  ok(!!ann, 'the comment is on the wire for the agent to answer');
  const replied = await fetch(`${BASE}/api/artifacts/${id}/annotations/${ann.id}`, {
    method: 'POST', headers: auth, body: JSON.stringify({ reply: AGENT_REPLY }),
  });
  ok(replied.ok, 'the agent replies with a fenced block over plain HTTP');

  // …and it is READ, in the still-open tab, with no reload.
  const rendered = await until(
    () => thread.evaluate((el) => {
      const pre = el.querySelector('pre');
      return {
        pre: pre?.textContent ?? null,
        items: [...el.querySelectorAll('[data-markdown] li')].map((li) => li.textContent),
        code: [...el.querySelectorAll('code')].map((c) => c.textContent),
        strong: [...el.querySelectorAll('strong')].map((c) => c.textContent),
        fence: el.textContent.includes('```'),
        wider: el.scrollWidth > el.clientWidth + 1,
      };
    }).catch(() => null),
    (state) => typeof state?.pre === 'string',
    15000,
  );
  ok(rendered?.pre === 'const MAX = 10;', `the fenced block arrives live as a <pre> (got ${JSON.stringify(rendered?.pre)})`);
  ok(rendered?.items?.join('|') === 'bumped the cap|added a test', `the list arrives as <li>s (got ${JSON.stringify(rendered?.items)})`);
  ok(rendered?.code?.includes('lib/config.ts'), 'a backticked identifier is a <code>, not a backtick');
  ok(rendered?.strong?.includes('10'), 'the emphasis is a <strong>');
  ok(rendered?.fence === false, 'the fence markers themselves are gone');
  ok(rendered?.wider === false, 'the code block scrolls inside the rail rather than widening it');

  // The wire NEVER carries the rendering — the body is the text as written.
  const after = await (await fetch(`${BASE}/api/artifacts/${id}/annotations?status=all`, { headers: auth })).json();
  ok(after.annotations?.[0]?.thread?.[1]?.body === AGENT_REPLY, 'the stored body is still the exact markdown text the agent sent');
  await ctx.close();
}

/**
 * A LONG REPLY MUST NOT PUSH THE SHORT ONE OFF THE RAIL (F6) — and a resolved
 * card must READ as resolved (F7).
 *
 * The failure this exists for is a LAYOUT fact and nothing below a browser can
 * see it: sixty lines of agent answer, a phone whose comment sheet is half the
 * screen, and the human's own two-line reply somewhere below the bottom of it.
 * So the measurement is the real one — the reply's rect against the sheet's —
 * and the fold is measured the same way the product measures it, from what was
 * actually laid out. The muting is read as a COMPUTED opacity for the same
 * reason: a class name in the markup proves nothing about what Tailwind built.
 */
const FOLD_DOC =
  '<Helmet><title>Folding comments</title></Helmet>'
  + '<div data-design="tw" className="p-10">'
  + '<h1>The cap</h1>'
  + '<p id="cap">The cap is 5 today.</p>'
  + '</div>';

const LONG_AGENT_REPLY = Array.from({ length: 60 }, (_, i) => `line ${i + 1} of the agent's answer`).join('\n');
const HUMAN_LAST_WORD = 'ship it — thanks';

async function foldLeg(browser) {
  const { id, token } = await startDocument(BASE);
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const published = await fetch(`${BASE}/api/artifacts/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ markup: FOLD_DOC }) });
  if (!published.ok) throw new Error(`fold leg publish failed (${published.status}): ${await published.text()}`);

  // A PHONE: the rail is a half-height bottom sheet there, which is where a
  // long comment costs the most.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await becomeOwner(page, BASE, token);
  await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
  const frame = page.frameLocator('iframe[title="artifact"]');
  await frame.locator('#cap').waitFor({ timeout: 15000 });

  const head = await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: auth })).json();
  const created = await page.evaluate(async ([docId, editId]) => {
    const res = await fetch(`/api/my/artifacts/${docId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '0.1', edit_id: editId, body: 'why is the cap 5?' }),
    });
    return { status: res.status, body: await res.text() };
  }, [id, head.edit_id]);
  ok(created.status === 201, `the owner leaves a comment (${created.status} ${created.body.slice(0, 120)})`);

  const wire = await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: auth })).json();
  const ann = wire.annotations?.[0];
  // The screenshot case: the agent answers at length, the human answers shortly.
  const replied = await fetch(`${BASE}/api/artifacts/${id}/annotations/${ann.id}`, {
    method: 'POST', headers: auth, body: JSON.stringify({ reply: LONG_AGENT_REPLY }),
  });
  ok(replied.ok, 'the agent answers with sixty lines over plain HTTP');
  const lastWord = await page.evaluate(async ([docId, annId, body]) => {
    const res = await fetch(`/api/my/artifacts/${docId}/annotations/${annId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reply: body }),
    });
    return res.status;
  }, [id, ann.id, HUMAN_LAST_WORD]);
  ok(lastWord === 200, `the human answers shortly underneath (${lastWord})`);

  await openArtifactControls(page);
  await page.locator('[aria-label="Toggle comments"]').click();
  // No Escape here, unlike the desktop legs: on a phone the rail IS a sheet,
  // and Escape is how a sheet closes.
  await page.locator('[aria-label="Annotation sidebar"]').waitFor({ timeout: 8000 });
  await page.locator('[aria-label="Open annotation thread"]').first().click({ timeout: 15000 });
  await page.locator('[aria-label="Reply to annotation"]').first().waitFor({ timeout: 8000 });

  const read = () => page.evaluate((reply) => {
    const sheet = document.querySelector('[aria-label="Annotation sidebar"]');
    const thread = document.querySelector('[aria-label="Annotation thread"]');
    if (!sheet || !thread) return null;
    const node = [...thread.querySelectorAll('p, li, div')]
      .reverse()
      .find((el) => el.textContent?.trim() === reply);
    // The page's own action bar FLOATS OVER the bottom of the sheet on a
    // phone, so the sheet's rect is not what a reader can see. Measure against
    // what is left of it.
    const bar = document.querySelector('[aria-label="Page actions"][data-scroll-hidden="false"]');
    const barTop = bar?.getBoundingClientRect().top ?? Infinity;
    const sheetBox = sheet.getBoundingClientRect();
    const replyBox = node?.getBoundingClientRect() ?? null;
    // The agent's answer is the second message; its TOP is what says whether
    // the conversation still reads as one.
    const answer = thread.querySelectorAll('li')[1]?.getBoundingClientRect() ?? null;
    return {
      clamped: !!thread.querySelector('[data-folded-body="clamped"]'),
      control: thread.querySelector('[aria-label="Show whole comment"]')?.textContent ?? null,
      hasLastLine: thread.textContent.includes("line 60 of the agent's answer"),
      barMeasured: Number.isFinite(barTop),
      sheet: { top: sheetBox.top, bottom: Math.min(sheetBox.bottom, barTop) },
      reply: replyBox && { top: replyBox.top, bottom: replyBox.bottom },
      answerTop: answer?.top ?? null,
    };
  }, HUMAN_LAST_WORD);

  /*
   * WAIT FOR THE GEOMETRY TO STOP MOVING, NOT MERELY FOR THE FOLD TO EXIST.
   *
   * Opening a thread scrolls it into view, and the fold can be in the DOM
   * before that scroll has settled — so `clamped === true` is a signal about
   * the CONTENT and says nothing about where the content currently is. Reading
   * on that signal alone measures a sheet mid-scroll.
   *
   * Measured, and this is the whole reason the assertions below are worth
   * anything: over 33 local runs the thread read 88px low twice, always the
   * same 88 (thread top 471 rather than 383, the reply at 843 rather than 755,
   * every element inside it identical in size). The same page read again 800ms
   * later was at the settled position every time. In CI it cost two red merge
   * gates and three re-runs, and it read as a product bug — a phone reader
   * unable to see the human's reply — which it is not.
   *
   * So the wait is for the ANSWER'S TOP to repeat: a scroll that has finished
   * reports the same offset twice, a scroll in flight does not. Polling for
   * stability rather than sleeping a fixed time keeps the settled case fast.
   */
  const readSettled = async () => {
    let previous = null;
    for (let i = 0; i < 60; i++) {
      const s = await read();
      if (s?.clamped === true && s.answerTop !== null && s.answerTop === previous) return s;
      previous = s?.answerTop ?? null;
      await page.waitForTimeout(50);
    }
    return read();
  };
  const folded = await readSettled();
  ok(folded?.clamped === true, 'the sixty-line agent answer arrives folded');
  // Without this, a hidden bar makes the bound below the SHEET's rect again —
  // the bound that passed while the reply sat invisible behind the bar.
  ok(folded?.barMeasured === true, 'the action bar is up: the bound below is the visible area, not the sheet rect');
  ok(/^show more \(\d+ lines\)$/.test(folded?.control ?? ''), `the fold offers to open itself (${JSON.stringify(folded?.control)})`);
  ok(folded?.hasLastLine === true, 'clamped, not truncated: the whole answer is still in the document');
  ok(!!folded?.reply
    && folded.reply.top >= folded.sheet.top - 1
    && folded.reply.bottom <= folded.sheet.bottom + 1,
  `the human's own reply is visible without scrolling the sheet (reply ${JSON.stringify(folded?.reply)} in sheet ${JSON.stringify(folded?.sheet)})`);
  ok(typeof folded?.answerTop === 'number' && folded.answerTop >= folded.sheet.top - 1,
    `the agent's answer BEGINS on screen too — the fold is what fits both (answer top ${folded?.answerTop}, sheet top ${folded?.sheet.top})`);

  await page.locator('[aria-label="Show whole comment"]').first().click();
  const opened = await until(read, (s) => s?.clamped === false, 5000);
  ok(opened?.clamped === false, 'tapping "show whole comment" expands it');
  ok(await page.locator('[aria-label="Show less of comment"]').first().isVisible(), 'and offers to fold it back');
  // THE A/B, so nothing above can pass vacuously: opened, the same sixty lines
  // push the human's reply straight off the sheet. That is what the fold buys,
  // measured on the same thread a moment apart.
  ok(!!opened?.reply && opened.reply.top > opened.sheet.bottom,
    `unfolded, the sixty lines push the human's reply off the sheet (reply ${JSON.stringify(opened?.reply)} vs sheet ${JSON.stringify(opened?.sheet)})`);
  await page.locator('[aria-label="Show less of comment"]').first().click();
  const refolded = await until(read, (s) => s?.clamped === true, 5000);
  ok(!!refolded?.reply && refolded.reply.bottom <= refolded.sheet.bottom + 1, 'folding it back brings the reply home');

  // ── F7: a resolved card reads as resolved ─────────────────────────────
  const resolvedRes = await fetch(`${BASE}/api/artifacts/${id}/annotations/${ann.id}`, {
    method: 'POST', headers: auth, body: JSON.stringify({ resolve: true }),
  });
  ok(resolvedRes.ok, 'the agent resolves the thread over plain HTTP');
  const muted = await until(
    () => page.evaluate(() => {
      const card = document.querySelector('[aria-label="Resolved annotation thread"]');
      const open = document.querySelector('[aria-label="Annotation thread"]');
      return card
        ? { opacity: Number(getComputedStyle(card).opacity), open: open ? Number(getComputedStyle(open).opacity) : null }
        : null;
    }),
    (state) => typeof state?.opacity === 'number',
    12000,
  );
  ok(!!muted && muted.opacity > 0.4 && muted.opacity < 0.8,
    `the resolved card is muted rather than identical to an open one (opacity ${muted?.opacity})`);
  ok(muted?.open === null || muted.open === 1, `an open card beside it stays at full opacity (${muted?.open})`);
  ok(await page.locator('[aria-label="Show resolved conversation"]').first().isVisible(),
    'muted is not disabled: the resolved card still offers its conversation');
  await ctx.close();
}

run().then(() => {
  if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1); }
  console.log('\nall good');
}).catch((err) => { console.error(err); process.exit(1); });
