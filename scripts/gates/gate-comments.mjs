/**
 * Gate: COMMENTS — the owner pins feedback to a node, the agent answers.
 *
 * One journey over a shared fixture set (folded in from the former annotations and comment-targets gates).
 * The loop no unit test can make, because every seam is a browser fact: the
 * owner selects text INSIDE the document's frame, the composer is PAGE chrome
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
 * draws against it, and a capability only the page may grant. Pins on declarative
 * content (a keyed repeat, a table cell, an unkeyed list) follow their item through
 * reorder, removal, restoration and a reload.
 *
 * The signed-in COMMENTER's own journey (a stranger given `can comment` by the link selects words in the frame,
 * is offered annotate and not edit, and the owner sees the count arrive) needs a mail login, so it rides
 * gate-collab-roles with the rest of the role checks; this gate needs no mail.
 *
 *   usage: node scripts/gates/gate-comments.mjs [base]
 */
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { launchChromium } from './lib/browser.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { DOCUMENT_FRAME, documentFrame, documentLocator } from './lib/page-facts.mjs';
import { becomeOwner, startDocument } from '../lib/start-doc.mjs';
import { expect } from 'playwright/test';
import { commentTargetsMarkup } from '../fixtures/comment-targets.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('comments');
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

/** The app bar's Comment button, which carries the open-comment count. */
const COMMENT_GLYPH = 'header[aria-label="Page bar"] [aria-label="Comment"]';

/** How far the document's frame stops short of the page's right edge (the width it leaves a rail), in px. */
const frameRightInset = async (page) => {
  const box = await page.locator(DOCUMENT_FRAME).boundingBox();
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  return box ? Math.round(width - (box.x + box.width)) : null;
};

/** Page coordinates of a point given in the document frame's own viewport. */
const toPage = async (page, point) => {
  const box = await page.locator(DOCUMENT_FRAME).boundingBox();
  return { x: point.x + (box?.x ?? 0), y: point.y + (box?.y ?? 0) };
};

/**
 * Put the controls panel away with Escape. `openArtifactControls` hands the keyboard to the panel (so Escape reaches
 * the page, not the frame), and closing it returns focus to its trigger, whose keyboard-focus tooltip then sits over
 * the rail's header. A pointer user's focus never left the trigger, so it shows none: blur it, as their next click would.
 */
const dismissControls = async (page) => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; a?.blur?.(); });
};

const DOC =
  '<Helmet><title>Annotated</title></Helmet>'
  + '<div data-design="tw" className="p-10">'
  + '<h1>Quarterly report</h1>'
  + '<p id="intro">An intro paragraph of ordinary prose.</p>'
  // Nested on purpose: a breadcrumb only offers non-root ancestors, so the
  // section is what proves the crumb renders and re-targets.
  + '<section className="max-w-2xl"><p id="figure">Revenue grew 40% in Q3.</p><ul id="list"><li>one</li><li>two</li></ul></section>'
  + '</div>';

/** The shared fixture set: every document this journey reads, published up front and at once. */
const publish = async (markup, extra = {}) => {
  const { id, token } = await startDocument(BASE);
  const put = await fetch(`${BASE}/api/artifacts/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ markup, ...extra }),
  });
  if (!put.ok) throw new Error(`publish failed (${put.status}): ${await put.text()}`);
  return { id, token };
};

async function ownerLeg(browser, { id, token }) {
  {
    // ── the owner's tab ────────────────────────────────────────────────────
    const owner = await browser.newContext();
    const page = await owner.newPage();
    await becomeOwner(page, BASE, token);
    await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
    const frame = documentLocator(page);
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
    check(await bubble.isVisible(), 'selecting text in view mode raises the action bubble inside the document');
    check(await frame.locator('[aria-label="Edit selected text"]').count() === 1
      && await frame.locator('[aria-label="Comment on selected text"]').count() === 1,
      'the owner is offered both edit and annotate');

    // Choosing Annotate opens the composer on those exact words — and enters
    // NOTHING. Commenting is a layer, so no hash moves and no mode opens.
    await frame.locator('[aria-label="Comment on selected text"]').click();
    const seeded = await until(() => page.locator('[aria-label="Annotation comment"]').count(), (n) => n === 1, 10000);
    check(seeded === 1, 'the composer opens on the selected words — no second click on the same text');
    check(await page.evaluate(() => location.hash) === '', 'commenting enters no mode: the hash is untouched');
    check(await frame.locator('#figure[data-mx-annotate-selected]').count() === 1,
      'the frame marks the node the composer is composing on');
    check(await page.locator('[aria-label="Select section"]').count() >= 1, 'the composer carries the selection breadcrumb');

    // Write it from the composer the bubble opened.
    await page.locator('[aria-label="Annotation comment"]').fill('this number looks wrong — check the Q3 sheet');
    await page.locator('[aria-label="Save annotation"]').click();

    // Saving tints the commented node (the Docs highlight).
    const highlighted = frame.locator('#figure[data-mx-annotated]');
    await highlighted.waitFor({ timeout: 8000 });
    check(true, 'saving tints the commented node');

    // ── the rail is a PANEL, not a mode ───────────────────────────────────
    await openArtifactControls(page);
    await page.locator('[aria-label="Toggle comments"]').click();
    await page.locator('[aria-label="Annotation sidebar"]').waitFor({ timeout: 8000 });
    check(await page.evaluate(() => location.hash) === '', 'opening the rail moves no hash');
    await openArtifactControls(page);
    check(await page.locator('[aria-label="Edit artifact"]').count() === 1, 'edit stays offered while the rail is open');
    await dismissControls(page);
    const thread = page.locator('[aria-label="Annotation thread"]');
    check((await thread.textContent())?.includes('Q3 sheet'), 'the saved comment appears as a rail thread');
    // "The frame stays full-width so the bar inside it does not move" is retired: the bar is the app page's own
    // (solid/document/DocumentChrome), above the frame, so the frame itself gives the rail its width.
    const railInset = await until(() => frameRightInset(page), (v) => v === 320, 5000);
    check(railInset === 320, `the document leaves the rail its width (got ${railInset}px)`);
    check(await page.locator('[aria-label="Annotation sidebar"]').evaluate((el) => el.style.top === '44px'),
      'the rail sits under the document\'s bar');

    await page.locator('[aria-label="Close comments"]').click();
    const railGone = await until(() => page.locator('[aria-label="Annotation sidebar"]').count(), (n) => n === 0, 5000);
    check(railGone === 0, 'closing the rail puts the panel away');

    // THE INVERSION: the tint used to leave with the mode. It is ambient now,
    // so it stays — and a compact identity marker floats beside it.
    const stillTinted = await until(() => frame.locator('#figure[data-mx-annotated]').count(), (n) => n === 1, 5000);
    check(stillTinted === 1, 'the tint is ambient: a commented node stays marked with no rail and no mode');
    // The count rides the app bar's Comment button (solid/document/DocumentChrome), kept live by the page.
    check((await page.locator(COMMENT_GLYPH).textContent())?.trim() === '1', 'the comment glyph carries the unresolved count');
    const viewComments = page.locator('[aria-label="Open annotation comments"]');
    await viewComments.waitFor({ timeout: 8000 });
    const viewComment = page.locator('[aria-label^="Open annotation conversation by"]');
    await viewComment.waitFor({ timeout: 8000 });
    const compactBox = await viewComment.boundingBox();
    check(!!compactBox && compactBox.width <= 40 && compactBox.height <= 40,
      'the ambient annotation is a compact identity marker');
    const railGone2 = await until(() => frameRightInset(page), (v) => v === 0, 5000);
    check(railGone2 === 0, `closing the rail gives the document its width back (${railGone2}px)`);
    check(await page.locator('[aria-label="Artifact viewport"]').evaluate((el) => (el).style.right === '0px'),
      'the floating marker leaves the document full-width');
    await viewComment.hover();
    const expandedBox = await until(() => viewComment.boundingBox(), (box) => !!box && box.width > 250, 5000);
    check((await viewComments.textContent())?.includes('Q3 sheet'), 'hover reveals the conversation preview');
    const anchorBox = await frame.locator('#figure').boundingBox();
    const commentBox = expandedBox;
    // The marker follows the WORDS (a comment keeps its selection, and its
    // rect is the union of the highlighted ranges), so it sits on the text
    // LINE rather than on the paragraph box — half-leading apart, a handful of
    // pixels. It is still the annotated content it follows.
    check(!!anchorBox && !!commentBox && Math.abs(anchorBox.y - commentBox.y) <= 12,
      `the annotation marker follows its annotated content vertically (${Math.round(Math.abs((anchorBox?.y ?? 0) - (commentBox?.y ?? 0)))}px apart)`);
    const viewportWidth = await page.evaluate(() => innerWidth);
    check(!!commentBox
      && commentBox.x >= 0
      && commentBox.x + commentBox.width <= viewportWidth
      && Math.abs(viewportWidth - (commentBox.x + commentBox.width) - 12) <= 2,
    'the expanded preview stays fixed to the right and inside the viewport');

    // There is no second visibility state: annotations remain ambient and the
    // artifact controls only open the full rail.
    await page.mouse.move(400, 20);
    await openArtifactControls(page);
    check(await page.locator('[aria-label="Hide comments"], [aria-label="Show comments"]').count() === 0,
      'artifact controls carry no annotation visibility toggle');
    await dismissControls(page);

    // Clicking the compact conversation opens the rail FOCUSED on that thread,
    // ready to continue — a panel, still not a mode.
    await viewComment.click();
    await page.locator('[aria-label="Annotation sidebar"]').waitFor({ timeout: 8000 });
    await frame.locator('#figure[data-mx-annotation-open]').waitFor({ timeout: 8000 });
    check(await page.evaluate(() => location.hash) === '', 'opening a thread never touches the URL');
    check((await thread.first().textContent())?.includes('Q3 sheet') && await page.locator('[aria-label="Reply to annotation"]').first().isVisible(),
      'clicking the floating marker opens the rail focused and ready to reply');

    // ── the agent's side, over plain HTTP ─────────────────────────────────
    const wire = await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const ann = wire.annotations?.[0];
    check(!!ann && ann.snippet.includes('Revenue grew 40%'), 'GET /api/artifacts/<id> inlines the annotation with its snippet');
    check(wire.open_annotations === 1, 'the wire carries the open count');
    check(typeof ann?.anchor?.nodeId === 'string' && wire.markup.includes(`id="${ann.anchor.nodeId}"`), 'the comment addresses a persisted source id');

    // The case the ids exist for: a full-replace PUT that keeps the attribute keeps the annotation.
    const rewritten = wire.markup.replace('grew 40%', 'grew 34%');
    const putRes = await fetch(`${BASE}/api/artifacts/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ markup: rewritten }),
    });
    check(putRes.ok, 'the agent full-replaces the document, preserving the annotation anchor');
    const afterPut = await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    check(afterPut.annotations?.[0]?.orphaned === false && afterPut.annotations?.[0]?.snippet.includes('34%'),
      'the annotation survives the PUT and its snippet follows the new text');
    const stillHighlighted = await until(() => frame.locator('#figure[data-mx-annotated]').count(), (n) => n === 1, 10000);
    check(stillHighlighted === 1, 'the open tab re-highlights the node after the live adopt');

    const resolved = await (await fetch(`${BASE}/api/artifacts/${id}/annotations/${ann.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: 'Recomputed — it was 34%. Fixed.', resolve: true }),
    })).json();
    check(resolved.status === 'resolved' && resolved.thread?.length === 2, 'the agent replies and resolves in one POST');

    // Resolution retains the conversation in history while clearing its document highlight.
    const retained = await until(async () => ({
      thread: await page.getByLabel('Resolved annotation thread').filter({hasText:'Recomputed'}).count(),
      highlight: await frame.locator('[data-mx-annotated]').count(),
    }), state => state.thread === 1 && state.highlight === 0, 10000);
    check(retained.thread === 1 && retained.highlight === 0, 'the resolve reaches the open tab live: the conversation remains and the highlight clears');
    const threadGone = await until(() => page.locator('[aria-label="Annotation thread"]').count(), (n) => n === 0, 8000);
    check(threadGone === 0, 'the open-thread list empties live too');
    const badgeGone = await until(() => page.locator(COMMENT_GLYPH).textContent().then((t) => (t ?? '').trim()), (t) => t === '', 5000);
    check(badgeGone === '', 'the count badge drops with the resolve');
    const resolvedCard = await until(() => page.locator('[aria-label="Resolved annotation thread"]').count(), (n) => n === 1, 8000);
    check(resolvedCard === 1, 'resolved history lists the closed thread below the open list');

    // The last resolved thread must retain its marker even though the open count is zero.
    await page.getByLabel('Close comments').click();
    await page.locator('[aria-label^="Open annotation conversation by"]').waitFor({timeout:5000});
    check(true,'the last resolved thread keeps its countdown marker after closing the rail');
    await page.locator('[aria-label^="Open annotation conversation by"]').click();
    await page.getByLabel('Hide resolved conversation').waitFor({timeout:5000});
    // Closing the retained conversation leaves it in history; reopen it to delete.
    await page.getByLabel('Hide resolved conversation').click();
    await page.locator('[aria-label="Show resolved conversation"]').click();
    await page.locator('[aria-label="Annotation actions"]').click();
    await page.locator('[aria-label="Delete annotation"]').click();
    await page.getByLabel('Confirm delete comment', { exact: true }).click();
    const allGone = await until(() => page.locator('[aria-label="Resolved annotation thread"]').count(), (n) => n === 0, 8000);
    check(allGone === 0, 'delete erases the thread from the history');
    const wireAfter = await (await fetch(`${BASE}/api/artifacts/${id}/annotations?status=all`, { headers: { Authorization: `Bearer ${token}` } })).json();
    check(wireAfter.annotations?.length === 0, 'the delete reached storage — nothing left on the wire');

    // ── THE POINT OF ALL OF THIS: comment WHILE editing ───────────────────
    // Type into a paragraph, then comment on that same paragraph without
    // leaving edit mode. The comment's anchor is a real CAS edit and the
    // editor answers a 409 by adopting the server's document, so this is
    // exactly where un-drained typing would be thrown away.
    // The rail is still open here, so the controls panel opens beside it — and has to paint ABOVE it to be pressed.
    await openArtifactControls(page);
    const editOnTop = await page.locator('[aria-label="Edit artifact"]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      let hit = document.elementFromPoint(x, y);
      while (hit?.shadowRoot) { const inner = hit.shadowRoot.elementFromPoint(x, y); if (!inner || inner === hit) break; hit = inner; }
      return !!hit && (hit === el || el.contains(hit));
    });
    check(editOnTop, 'the controls panel opened beside the open rail paints above it: Edit artifact can be pressed');
    if (editOnTop) await page.locator('[aria-label="Edit artifact"]').click();
    // Covered, the rest of the gate still enters editing the other way a reader can: the bar's own Edit.
    else { await dismissControls(page); await page.locator('header[aria-label="Page bar"] [aria-label="Edit"]').click(); }
    await until(() => page.evaluate(() => location.hash), (h) => h === '#edit');
    // In edit mode the comments control lives in the settings panel, opened
    // through the app bar's controls — no button in the editor bar.
    await openArtifactControls(page);
    const editComments = await until(() => page.locator('[aria-label="Toggle comments"]').count(), (n) => n === 1, 5000);
    check(editComments === 1, 'the comments control survives entering edit mode');
    // Put the panel away: its click-away scrim covers the frame, and the
    // paragraph click below must reach the document.
    await dismissControls(page);
    await until(() => page.locator('[aria-label="Artifact controls"]').count(), (n) => n === 0, 5000);

    // Clicked-until-it-takes, like every other in-frame click here: the edit
    // chunk and the frame's re-render after the agent's PUT both land a beat
    // after the mode does, and a click in that beat selects nothing.
    await page.getByRole('tab', { name: 'Selection', exact: true }).click();
    const para = frame.locator('#figure');
    const toolbar = page.locator('[aria-label="Typography toolbar"]');
    const editorSelected = await until(async () => {
      await para.click({ timeout: 2000 }).catch(() => {});
      return toolbar.isVisible().catch(() => false);
    }, (v) => v === true, 20000);
    if (!editorSelected) console.error('Compiled annotation edit state:', JSON.stringify({
      hash: await page.evaluate(() => location.hash),
      figure: await para.evaluate(el => ({ editable: el.isContentEditable, html: el.outerHTML.slice(0, 250) })).catch(() => null),
      loading: await page.getByLabel('Loading document').count(),
      toolbar: await toolbar.count(),
    }));
    check(await toolbar.isVisible(), 'the editor selects the annotated paragraph');
    // The editor transition may preserve the selection while focus moves to the
    // app chrome. Type into the editable paragraph, as a reader does.
    await para.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' MIDSENTENCE');
    check((await para.innerText()).includes('MIDSENTENCE'), 'typing reached the editor before opening a comment');

    // The toolbar's Comment button keeps focus in the host on mousedown, so
    // the typing above is still UNCOMMITTED when the composer opens.
    await page.locator('[aria-label="Comment on selection"]').click();
    const editComposer = await until(() => page.locator('[aria-label="Annotation comment"]').count(), (n) => n === 1, 10000);
    check(editComposer === 1, 'the editor toolbar opens the composer without leaving edit mode');
    check(await page.evaluate(() => location.hash) === '#edit', 'commenting mid-edit stays in edit mode');
    await page.locator('[aria-label="Annotation comment"]').fill('written without leaving the editor');
    await page.locator('[aria-label="Save annotation"]').click();
    await until(() => page.locator('[aria-label="Annotation comment"]').count(), (n) => n === 0, 10000);

    // Commenting is relation-only. The editor may still hold these keystrokes
    // until its ordinary autosave/exit; the comment must not discard them.
    const afterMid = await until(
      async () => (await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json()),
      (w) => (w?.annotations?.length ?? 0) === 1,
      15000,
    );
    check((afterMid?.annotations?.length ?? 0) === 1, 'the mid-edit comment reached storage');
    check((await frame.locator('#figure').innerText()).includes('MIDSENTENCE'),
      'uncommitted typing survives a relation-only comment');

    // …and the layer is ambient INSIDE the editor: the node just commented on
    // is tinted while the document is still editable.
    const tintWhileEditing = await until(() => frame.locator('#figure[data-mx-annotated]').count(), (n) => n === 1, 10000);
    check(tintWhileEditing === 1, 'commented nodes are tinted inside the editor');

    await page.locator('[aria-label="Exit edit mode"]').click();
    await until(() => page.evaluate(() => location.hash), (h) => h === '');
    const persistedTyping = await until(
      async () => (await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json()),
      (w) => typeof w?.markup === 'string' && w.markup.includes('MIDSENTENCE'),
      15000,
    );
    check(persistedTyping?.markup?.includes('MIDSENTENCE'), 'ordinary editor exit persists the typing without comment-triggered writes');

    // ── a logged-out reader sees nothing ──────────────────────────────────
    const strangerCtx = await browser.newContext();
    const stranger = await strangerCtx.newPage();
    await stranger.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
    const strangerDoc = documentLocator(stranger);
    await strangerDoc.locator('#figure').waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(1500);
    const strangerPins = await strangerDoc.locator('[data-mx-annotated], [data-mx-annotation-open]').count().catch(() => 0)
      + await stranger.locator('[data-mx-annotated], [data-mx-annotation-open], [aria-label^="Open annotation conversation by"]').count();
    const strangerButtons = await stranger.locator('[aria-label="Toggle comments"]').count();
    check(strangerPins === 0 && strangerButtons === 0, 'a logged-out reader sees no pins and no annotate chrome');
    // A reader's selection happens inside the document's frame, like the owner's — and nothing grants them an
    // action, so no chunk loads.
    await strangerDoc.locator('#figure').click({ clickCount: 3, timeout: 2000 }).catch(() => {});
    await sleep(500);
    check(await strangerDoc.locator('[data-mx-selection-actions]').count().catch(() => 0) === 0,
      'a reader selecting text is offered nothing at all');
    await strangerCtx.close();
    await owner.close();
  }
}

/*
 * Two lanes over one browser, then the fold leg ALONE: its measurement is scroll geometry that read 88px low under
 * load (see foldLeg), so it never shares the machine with another of this gate's pages. A lane that throws is a
 * failed check, and the other lane still reports.
 */
const run = async () => {
  const [main, quote, md, fold, pick, targets] = await Promise.all([
    publish(DOC), publish(QUOTE_DOC), publish(MD_DOC), publish(FOLD_DOC), publish(DOC),
    publish(commentTargetsMarkup, { title: 'Dynamic comment acceptance', visibility: 'unlisted' }),
  ]);
  const browser = await launchChromium();
  const lane = async (name, legs) => {
    for (const [leg, fixture] of legs) {
      try { await leg(browser, fixture); } catch (error) { check(false, `${name}: ${leg.name} could not finish (${String(error?.stack ?? error).split('\n').slice(0, 4).join(' | ')})`); }
    }
  };
  try {
    await Promise.all([
      // the owner's loop (select → rail → agent resolve live → comment mid-edit → a stranger sees nothing),
      // then the comment that keeps the exact words, then an agent's reply read as markdown
      lane('owner lane', [[ownerLeg, main], [quoteLeg, quote], [markdownLeg, md]]),
      // pins that follow declarative items, then a block PICKED and an area drawn
      lane('pick lane', [[targetsLeg, targets], [pickLeg, pick]]),
    ]);
    // a long reply folds; a resolved card reads as resolved
    await lane('fold', [[foldLeg, fold]]);
  } finally {
    await browser.close();
  }
};

/**
 * A COMMENT KEEPS THE WORDS, NOT JUST THE NODE.
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

async function quoteLeg(browser, { id, token }) {
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await becomeOwner(page, BASE, token);
  await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
  const frame = documentLocator(page);
  await frame.locator('#second').waitFor({ timeout: 15000 });
  const raw = await documentFrame(page);

  /*
   * The drag: from one CHARACTER inside the first paragraph to one inside the
   * second. Aimed by measuring the character rather than by taking a fraction
   * of the element's box — a paragraph's box is the whole column, so 45% of it
   * lands past the end of a short sentence and the drag starts on nothing.
   */
  const pointAt = async (selector, index) => {
    const inFrame = await raw.evaluate(([sel, at]) => {
      const range = document.createRange();
      range.setStart(document.querySelector(sel).firstChild, at);
      range.setEnd(document.querySelector(sel).firstChild, at + 1);
      const box = range.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }, [selector, index]);
    return toPage(page, inFrame);
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
  check(await bubble.isVisible(), 'a drag across two paragraphs raises the bubble');

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
  check(parts.length === 2 && parts[0].rel === '' && parts[1].rel === '+1',
    `the range is two parts, "" then "+1" (got ${JSON.stringify(parts.map((p) => p.rel))})`);
  check(FIRST_TEXT.endsWith(parts[0]?.text ?? 'x') && SECOND_TEXT.startsWith(parts[1]?.text ?? 'x'),
    'each part is exactly the run it covers in its own node');
  check(ann?.quote === `${parts[0]?.text} ${parts[1]?.text}`, 'the quote is the parts, one space between blocks');
  check(ann?.quote_found === true, 'the quoted words are still in the document');
  check(ann?.snippet === FIRST_TEXT, 'the snippet is still the whole anchored node — a different thing, kept');

  // (b) THE PAINT, AFTER A RELOAD: nothing about it is stored in the DOM, so a
  // reload is the honest test that the range alone can re-find the words.
  await page.reload({ waitUntil: 'load' });
  const reloaded = await documentFrame(page);
  await reloaded.waitForSelector('#second', { timeout: 15000 });
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
  check(paint.has, 'the frame registers a CSS highlight for the thread after a reload');
  check(paint.first && paint.second, 'the highlight covers words in BOTH paragraphs');
  check(paint.ranged, 'the anchored node gives up its own tint while its words are painted');

  // (c) AN AGENT REWORDS THE FIRST PARAGRAPH: the thread stays anchored, the
  // quote no longer reads as it did, and the paint falls back to the tint.
  const current = await read();
  const rewritten = current.markup.replace(FIRST_TEXT, 'Revenue was flat in Q3, behind plan.');
  const put = await fetch(`${BASE}/api/artifacts/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ markup: rewritten }) });
  check(put.ok, 'the agent rewords the annotated paragraph, keeping the anchor');
  const after = await until(read, (w) => w?.annotations?.[0]?.quote_found === false, 15000);
  check(after?.annotations?.[0]?.quote_found === false, 'quote_found turns false when the words are written away');
  check(after?.annotations?.[0]?.orphaned === false, 'the thread is still anchored — the node is still there');
  check(after?.annotations?.[0]?.quote === ann.quote, 'the quote itself is never recomputed');
  const fallback = await until(
    () => reloaded.evaluate((name) => ({
      highlighted: !!window.CSS?.highlights?.get(name),
      tinted: !!document.querySelector('#first[data-mx-annotated]'),
      ranged: !!document.querySelector('#first[data-mx-annotation-ranged]'),
    }), `mx-annotation-${ann.id}`).catch(() => null),
    (state) => state?.highlighted === false && state?.tinted === true && state?.ranged === false,
    15000,
  );
  check(fallback?.highlighted === false && fallback?.tinted === true && fallback?.ranged === false,
    `the live frame falls back to the whole-node tint (got ${JSON.stringify(fallback)})`);
  await ctx.close();
}

/**
 * AN AGENT'S REPLY IS PROSE WITH CODE IN IT.
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

async function markdownLeg(browser, { id, token }) {
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await becomeOwner(page, BASE, token);
  await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
  const frame = documentLocator(page);
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
  check(created.status === 201, `the owner leaves a comment (${created.status} ${created.body.slice(0, 120)})`);

  // Open the rail, and open the thread inside it: the compact surfaces show
  // the plain text on purpose, so only the opened thread renders the tree.
  await openArtifactControls(page);
  await page.locator('[aria-label="Toggle comments"]').click();
  await page.locator('[aria-label="Annotation sidebar"]').waitFor({ timeout: 8000 });
  await dismissControls(page);
  const thread = page.locator('[aria-label="Annotation thread"]').first();
  await thread.waitFor({ timeout: 8000 });
  await page.locator('[aria-label="Open annotation thread"]').first().click();
  check(await page.locator('[aria-label="Reply to annotation"]').first().isVisible(), 'the thread opens ready to reply');
  check(await page.locator('[aria-label="Bold"]').first().isVisible(), 'the reply box carries the markdown toolbar');

  // THE AGENT ANSWERS over plain HTTP, with a fenced block in the reply.
  const wire = await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: auth })).json();
  const ann = wire.annotations?.[0];
  check(!!ann, 'the comment is on the wire for the agent to answer');
  const replied = await fetch(`${BASE}/api/artifacts/${id}/annotations/${ann.id}`, {
    method: 'POST', headers: auth, body: JSON.stringify({ reply: AGENT_REPLY }),
  });
  check(replied.ok, 'the agent replies with a fenced block over plain HTTP');

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
  check(rendered?.pre === 'const MAX = 10;', `the fenced block arrives live as a <pre> (got ${JSON.stringify(rendered?.pre)})`);
  check(rendered?.items?.join('|') === 'bumped the cap|added a test', `the list arrives as <li>s (got ${JSON.stringify(rendered?.items)})`);
  check(rendered?.code?.includes('lib/config.ts'), 'a backticked identifier is a <code>, not a backtick');
  check(rendered?.strong?.includes('10'), 'the emphasis is a <strong>');
  check(rendered?.fence === false, 'the fence markers themselves are gone');
  check(rendered?.wider === false, 'the code block scrolls inside the rail rather than widening it');

  // The wire NEVER carries the rendering — the body is the text as written.
  const after = await (await fetch(`${BASE}/api/artifacts/${id}/annotations?status=all`, { headers: auth })).json();
  check(after.annotations?.[0]?.thread?.[1]?.body === AGENT_REPLY, 'the stored body is still the exact markdown text the agent sent');
  await ctx.close();
}

/**
 * A LONG REPLY MUST NOT PUSH THE SHORT ONE OFF THE RAIL — and a resolved
 * card must READ as resolved.
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

async function foldLeg(browser, { id, token }) {
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // A PHONE: the rail is a half-height bottom sheet there, which is where a
  // long comment costs the most.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await becomeOwner(page, BASE, token);
  await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
  const frame = documentLocator(page);
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
  check(created.status === 201, `the owner leaves a comment (${created.status} ${created.body.slice(0, 120)})`);

  const wire = await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: auth })).json();
  const ann = wire.annotations?.[0];
  // The screenshot case: the agent answers at length, the human answers shortly.
  const replied = await fetch(`${BASE}/api/artifacts/${id}/annotations/${ann.id}`, {
    method: 'POST', headers: auth, body: JSON.stringify({ reply: LONG_AGENT_REPLY }),
  });
  check(replied.ok, 'the agent answers with sixty lines over plain HTTP');
  const lastWord = await page.evaluate(async ([docId, annId, body]) => {
    const res = await fetch(`/api/my/artifacts/${docId}/annotations/${annId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reply: body }),
    });
    return res.status;
  }, [id, ann.id, HUMAN_LAST_WORD]);
  check(lastWord === 200, `the human answers shortly underneath (${lastWord})`);

  await openArtifactControls(page);
  await page.locator('[aria-label="Toggle comments"]').click();
  // No Escape here, unlike the desktop legs: on a phone the rail IS a sheet,
  // and Escape is how a sheet closes.
  await page.locator('[aria-label="Annotation sidebar"]').waitFor({ timeout: 8000 });
  await page.locator('[aria-label="Open annotation thread"]').first().click({ timeout: 15000 });
  await page.locator('[aria-label="Reply to annotation"]').first().waitFor({ timeout: 8000 });

  const read = () => page.locator('[aria-label="Annotation sidebar"]').evaluate((sheet, reply) => {
    const tree = sheet.getRootNode();
    const thread = tree.querySelector('[aria-label="Annotation thread"]');
    if (!sheet || !thread) return null;
    const node = [...thread.querySelectorAll('p, li, div')]
      .reverse()
      .find((el) => el.textContent?.trim() === reply);
    // The page's own action bar FLOATS OVER the bottom of the sheet on a
    // phone, so the sheet's rect is not what a reader can see. Measure against
    // what is left of it.
    const bar = tree.querySelector('[aria-label="Page actions"][data-scroll-hidden="false"]');
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
  check(folded?.clamped === true, 'the sixty-line agent answer arrives folded');
  // The page's floating action bar is gone (the chrome lives in the document
  // now), so the sheet's own rect IS the visible area: nothing covers it.
  check(/^show more \(\d+ lines\)$/.test(folded?.control ?? ''), `the fold offers to open itself (${JSON.stringify(folded?.control)})`);
  check(folded?.hasLastLine === true, 'clamped, not truncated: the whole answer is still in the document');
  check(!!folded?.reply
    && folded.reply.top >= folded.sheet.top - 1
    && folded.reply.bottom <= folded.sheet.bottom + 1,
  `the human's own reply is visible without scrolling the sheet (reply ${JSON.stringify(folded?.reply)} in sheet ${JSON.stringify(folded?.sheet)})`);
  check(typeof folded?.answerTop === 'number' && folded.answerTop >= folded.sheet.top - 1,
    `the agent's answer BEGINS on screen too — the fold is what fits both (answer top ${folded?.answerTop}, sheet top ${folded?.sheet.top})`);

  await page.locator('[aria-label="Show whole comment"]').first().click();
  const opened = await until(read, (s) => s?.clamped === false, 5000);
  check(opened?.clamped === false, 'tapping "show whole comment" expands it');
  check(await page.locator('[aria-label="Show less of comment"]').first().isVisible(), 'and offers to fold it back');
  // THE A/B, so nothing above can pass vacuously: opened, the same sixty lines
  // push the human's reply straight off the sheet. That is what the fold buys,
  // measured on the same thread a moment apart.
  check(!!opened?.reply && opened.reply.top > opened.sheet.bottom,
    `unfolded, the sixty lines push the human's reply off the sheet (reply ${JSON.stringify(opened?.reply)} vs sheet ${JSON.stringify(opened?.sheet)})`);
  await page.locator('[aria-label="Show less of comment"]').first().click();
  const refolded = await until(read, (s) => s?.clamped === true, 5000);
  check(!!refolded?.reply && refolded.reply.bottom <= refolded.sheet.bottom + 1, 'folding it back brings the reply home');

  // ── a resolved card reads as resolved ──────────────────────────────────
  const resolvedRes = await fetch(`${BASE}/api/artifacts/${id}/annotations/${ann.id}`, {
    method: 'POST', headers: auth, body: JSON.stringify({ resolve: true }),
  });
  check(resolvedRes.ok, 'the agent resolves the thread over plain HTTP');
  const muted = await until(
    () => page.locator('[aria-label="Resolved annotation thread"]').first().evaluate(card => {
      const open = card.getRootNode().querySelector('[aria-label="Annotation thread"]');
      return card
        ? { opacity: Number(getComputedStyle(card).opacity), open: open ? Number(getComputedStyle(open).opacity) : null }
        : null;
    }),
    (state) => typeof state?.opacity === 'number',
    12000,
  );
  check(!!muted && muted.opacity > 0.4 && muted.opacity < 0.8,
    `the resolved card is muted rather than identical to an open one (opacity ${muted?.opacity})`);
  check(muted?.open === null || muted.open === 1, `an open card beside it stays at full opacity (${muted?.open})`);
  check(await page.locator('[aria-label="Hide resolved conversation"]').first().isVisible(),
    'muted is not disabled: the resolved conversation remains open and dismissible');
  await ctx.close();
}

/**
 * PICKING A BLOCK, NOT WORDS. The rail's pick tool is the edit-mode move —
 * hover outlines the block, a click takes it — for a comment, which is the
 * only way to comment on a chart, an image or a whole list. Browser fact
 * throughout: a pointer moving over the sandboxed document, an outline the
 * frame PAINTS (computed style, not just a stamp), a click the frame takes
 * for itself, and the page's composer opening on what was picked.
 */
async function pickLeg(browser, { id, token }) {
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(()=>{if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'setCaptureHandleConfig',{value:undefined,configurable:true});});
  await becomeOwner(page, BASE, token);
  await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
  const frame = documentLocator(page);
  await frame.locator('#figure').waitFor({ timeout: 15000 });

  await openArtifactControls(page);
  // The comments control closes the panel itself — no Escape here, which
  // would now stand the pick down that opening the rail just started.
  await page.locator('[aria-label="Toggle comments"]').click();
  await page.locator('[aria-label="Annotation sidebar"]').waitFor({ timeout: 8000 });

  // Opening the rail starts Select; Screenshot remains a separate explicit action.
  const tool = page.locator('[aria-label="Select"]');
  check(await tool.count() === 1, 'the rail header offers the pick tool');
  check(await tool.getAttribute('aria-pressed') === 'true', 'opening the rail activates Select');
  check(await page.getByRole('button',{name:'Screenshot',exact:true}).getAttribute('aria-pressed') === 'false', 'opening the rail leaves Screenshot idle');
  await page.locator('[aria-label="Select tool active"]').waitFor();
  check(await tool.getAttribute('aria-pressed') === 'true', 'Select starts the pick');
  check(await page.locator('[aria-label="Select tool active"]').isVisible(), 'a pill over the document says what to do next');
  const promptBox = await page.locator('[aria-label="Select tool active"]').boundingBox();
  check(promptBox.y >= 44, 'the Select prompt sits below the app topbar');

  const intro = frame.locator('#intro');
  await intro.hover();
  const stamped = await until(() => intro.getAttribute('data-mx-annotate-pick-hover'), (v) => typeof v === 'string', 5000);
  check(typeof stamped === 'string', 'hovering a block while picking stamps it');
  const painted = await intro.evaluate((el) => getComputedStyle(el).outlineStyle);
  check(painted !== 'none', `…and the outline is PAINTED, not only stamped (outline-style ${painted})`);
  const cursor = await intro.evaluate((el) => getComputedStyle(el).cursor);
  check(cursor === 'crosshair', `the document cursor says pick (${cursor})`);

  await intro.click();
  const composer = await until(() => page.locator('[aria-label="Annotation comment"]').count(), (n) => n === 1, 10000);
  check(composer === 1, 'clicking the block opens the composer on it');
  check(await page.locator('[aria-label="Select tool active"]').count() === 0, 'the pick is one-shot: the pill is gone');
  check(await tool.getAttribute('aria-pressed') === 'false', '…and the tool is released');
  check(await frame.locator('#intro[data-mx-annotate-selected]').count() === 1, 'the picked block is marked as the subject');
  check(await frame.locator('[data-mx-annotate-pick-hover]').count() === 0, 'and the hover outline went with the pick');

  await page.locator('[aria-label="Annotation comment"]').fill('picked, not selected');
  check(await page.getByRole('button',{name:'Continue without screenshot',exact:true}).count() === 0, 'a block comment needs no screenshot fallback');
  await page.locator('[aria-label="Save annotation"]').click();
  const thread = await until(() => page.locator('[aria-label="Annotation thread"]').count(), (n) => n === 1, 10000);
  check(thread === 1, 'the comment lands as a rail thread');
  const tinted = await until(() => frame.locator('#intro[data-mx-annotated]').count(), (n) => n === 1, 8000);
  check(tinted === 1, 'the picked block is tinted like any commented node');
  const read = async () => (await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json());
  const wire = await until(read, (w) => (w?.annotations?.length ?? 0) === 1, 15000);
  check(wire?.annotations?.[0]?.snippet === 'An intro paragraph of ordinary prose.' && !wire?.annotations?.[0]?.quote,
    'the wire carries the whole block and no quote — a pick has no words');

  // Saving restores Select for the next comment; Escape explicitly stands it down.
  await page.locator('[aria-label="Select tool active"]').waitFor();
  check(await tool.getAttribute('aria-pressed') === 'true', 'saving restores Select for the next comment');
  await frame.locator('#figure').hover();
  await until(() => frame.locator('#figure[data-mx-annotate-pick-hover]').count(), (n) => n === 1, 5000);
  await page.keyboard.press('Escape');
  const stoodDown = await until(() => page.locator('[aria-label="Select tool active"]').count(), (n) => n === 0, 5000);
  check(stoodDown === 0, 'escape cancels a pick');
  const cleared = await until(() => frame.locator('[data-mx-annotate-pick-hover]').count(), (n) => n === 0, 5000);
  check(cleared === 0, '…and clears the outline');

  // ── a DRAWN AREA ──────────────────────────────────────────────────────
  // The Screenshot tool: a real drag from inside the figure paragraph into the
  // list below it. Neither is what was drawn — their SECTION is — and the
  // rectangle rides the comment as its range, painted back as an overlay.
  await page.getByRole('button',{name:'Screenshot',exact:true}).click();
  await page.getByRole('status',{name:'Screenshot tool active'}).waitFor();
  const screenshotReady = await until(() => page.getByRole('status',{name:'Screenshot tool active'}).textContent(), text => /drag/i.test(text ?? ''), 5000);
  check(/drag/i.test(screenshotReady ?? ''), 'the screenshot pill says to drag');
  // The pill is the PAGE's; the drag is taken by the document once the page's message arms it there (one bridge hop
  // later), so the press waits for the frame to be picking an area — what a reader's hand takes longer than anyway.
  await frame.locator('[data-mx-annotate-picking="area"]').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
  const from = await frame.locator('#figure').boundingBox();
  const to = await frame.locator('#list li').last().boundingBox();
  await page.mouse.move(from.x + 8, from.y + 4);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 2, { steps: 15 });
  check(await frame.locator('[data-mx-annotate-band]').count() === 1, 'the band is drawn while dragging');
  await page.mouse.up();
  const areaComposer = await until(() => page.locator('[aria-label="Annotation comment"]').count(), (n) => n === 1, 10000);
  check(areaComposer === 1, 'releasing the drag opens the composer');
  // From the former comment-targets gate: the composer a drawn area opens paints ABOVE the app's content.
  check(await page.getByLabel('Annotation composer', { exact: true }).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(el.getRootNode().elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }), 'the area composer is layered above the app content: its centre hits the composer');
  // The breadcrumb's TARGET crumb (the composer's icon badge carries the accent colour too).
  const crumb = await page.locator('[role="dialog"][aria-label="Annotation composer"] span.truncate.text-accent').first().textContent();
  check(crumb === 'section', `the anchor is the lowest common ancestor of what was drawn over (got ${crumb})`);
  check(await frame.locator('[data-mx-annotate-band]').count() === 1, 'the drawn area stays visible while composing');
  await page.locator('[aria-label="Annotation comment"]').fill('this whole region');
  await page.getByRole('button',{name:'Continue without screenshot',exact:true}).click();
  await page.locator('[aria-label="Save annotation"]').click();
  const areaWire = await until(read, (w) => (w?.annotations?.length ?? 0) === 2, 15000);
  const areaAnn = areaWire?.annotations?.find((a) => a.range?.kind === 'area');
  const box = areaAnn?.range?.box;
  check(!!box && box.x >= 0 && box.y >= 0 && box.x + box.w <= 1 && box.y + box.h <= 1 && box.w > 0 && box.h > 0,
    `the wire carries the area as fractions of the section (got ${JSON.stringify(box)})`);
  check(areaAnn?.quote === null && areaAnn?.quote_found === null, 'an area has no words: no quote, quote_found null');
  const overlay = await until(() => frame.locator(`[data-mx-annotation-area="${areaAnn?.id}"]`).count(), (n) => n === 1, 8000);
  check(overlay === 1, 'the saved area is painted back as an overlay box');
  check(await frame.locator('[data-mx-annotate-band]').count() === 0, 'and the composing band is gone');
  await ctx.close();
}

/**
 * PINS THAT FOLLOW THE ITEM, on declarative content (from the former comment-targets gate): a keyed repeat, a
 * DataTable cell and an unkeyed list, each commented by a real pick, then reordered, renamed, removed, restored and
 * reloaded. What stays is what the frame paints. The target GRAMMAR (`repeat` scope keys,
 * `{kind:'table',rowKey,columnKey}`) is parsed in services/app/lib/story/__tests__/comment-target.test.ts; the exact
 * values a browser click produces (`order-101`, an unkeyed owner's null range) are no longer asserted, and the
 * words-and-area comments on the unkeyed list, which asserted only those values, are dropped with them.
 */
async function targetsLeg(browser, seed) {
  const headers = { Authorization: `Bearer ${seed.token}`, 'Content-Type': 'application/json' };
  const annotations = async () => {
    const response = await fetch(`${BASE}/api/artifacts/${seed.id}/annotations`, { headers });
    if (!response.ok) throw new Error(`annotations: ${response.status}`);
    return (await response.json()).annotations;
  };
  /** A playwright `expect` (or a waitFor) as a verdict rather than a throw. */
  const holds = (promise) => promise.then(() => true, () => false);

  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  const page = await context.newPage();
  // This leg exercises anchoring. Capture itself is exercised by screenshot-comments.
  await page.addInitScript(() => { if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'setCaptureHandleConfig', { value: undefined }); });
  page.on('response', async (response) => { if (response.status() >= 400 && response.url().includes('/annotations')) console.error('Annotation request failed:', response.status(), await response.text()); });
  await becomeOwner(page, BASE, seed.token);
  await page.goto(`${BASE}/a/${seed.id}`);
  // The document runs in its own frame on its own origin; the rail, composer and tools are the app page's.
  const doc = documentLocator(page);
  // `Locator.and` cannot pair two locators inside a frame, so "is this one marked" is asked of its attribute.
  const annotated = (locator, timeout = 30000) => expect(locator).toHaveAttribute('data-mx-annotated', /.*/, { timeout });
  const cardText = doc.locator('p[data-mx-comment-owner="order-cards"]').filter({ hasText: 'Alice Chen' }).first();
  await cardText.waitFor();
  await openArtifactControls(page);
  await page.getByRole('button', { name: 'Toggle comments', exact: true }).click();
  await page.getByLabel('Annotation sidebar', { exact: true }).waitFor();
  const select = async () => {
    if (await page.getByRole('button', { name: 'Select', exact: true }).count() === 0) {
      await openArtifactControls(page);
      await page.getByRole('button', { name: 'Toggle comments', exact: true }).click();
    }
    const button = page.getByRole('button', { name: 'Select', exact: true });
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  };
  const save = async (body) => {
    await page.getByRole('dialog', { name: 'Annotation composer', exact: true }).waitFor();
    const fallback = page.getByRole('button', { name: 'Continue without screenshot', exact: true });
    if (await fallback.isVisible()) await fallback.click();
    await page.getByLabel('Annotation comment', { exact: true }).fill(body);
    await page.getByRole('button', { name: 'Save annotation', exact: true }).click();
    await page.getByLabel('Annotation composer', { exact: true }).waitFor({ state: 'hidden' });
    // Leave the resumed tool before testing ordinary document interactions.
    const cancelPick = page.getByRole('button', { name: 'Cancel picking', exact: true });
    if (await cancelPick.isVisible()) await cancelPick.click();
  };

  // ── a keyed repeat: the pin follows the order key through reverse and rename ──
  await select(); await cardText.click(); await save('Keep this comment on the repeated customer');
  await doc.getByRole('button', { name: 'Reverse JSX rows', exact: true }).click();
  await doc.getByRole('button', { name: 'Rename JSX Alice', exact: true }).click();
  await cardText.filter({ hasText: 'updated' }).waitFor();
  const repeatPinned = await holds(annotated(cardText, 10000));
  if (!repeatPinned) console.error('Compiled repeat pin state:', JSON.stringify({
    cards: await doc.locator('[data-mx-comment-owner="order-cards"]').evaluateAll((nodes) => nodes.map((node) => ({
      text: node.textContent, target: node.getAttribute('data-mx-comment-target'), annotated: node.hasAttribute('data-mx-annotated'),
    }))),
    owner: await doc.locator('#order-cards').getAttribute('data-mx-annotated'),
  }));
  check(repeatPinned, 'a For repeat comment stays on its keyed item after the rows reverse and the item is renamed');

  // ── a DataTable cell: the pin leaves with its row and returns with it ──
  const cell = doc.locator('td[data-mx-comment-owner="order-table"]').filter({ hasText: 'Alice Chen' }).first();
  await select(); await cell.click(); await save('Keep this comment on the table customer');
  const tableComment = (await annotations()).find((item) => item.thread[0].body === 'Keep this comment on the table customer');
  await doc.getByRole('button', { name: 'Remove JSX Alice', exact: true }).click();
  const detached = await holds(cell.waitFor({ state: 'detached' }));
  if (!detached) console.error('Compiled removed row state:', JSON.stringify({
    cells: await doc.locator('td[data-mx-comment-owner="order-table"]').evaluateAll((nodes) => nodes.map((node) => ({ text: node.textContent, target: node.getAttribute('data-mx-comment-target') }))),
    cards: await doc.locator('p[data-mx-comment-owner="order-cards"]').allTextContents(),
    errors: [...await page.getByRole('alert').allTextContents(), ...await doc.getByRole('alert').allTextContents()],
  }));
  check(detached, 'removing the row takes the commented table cell with it');
  await doc.getByRole('button', { name: 'Restore JSX Alice', exact: true }).click();
  check(await holds(annotated(cell)), 'restoring the row brings the table-cell pin back');
  check((await annotations()).find((item) => item.id === tableComment?.id)?.anchor?.nodeId === 'order-table',
    'the table comment keeps its owner node through removal and restoration');

  // ── an unkeyed list: comments stay on the whole list when rows move ──
  // (Picked BEFORE the one reload below, so that reload proves all three reconnect.)
  const unkeyed = doc.locator('#index-cards');
  const unkeyedAlice = unkeyed.locator('p').filter({ hasText: 'Alice Chen' }).first();
  await select(); await unkeyedAlice.click(); await save('Unkeyed list owner comment');
  // Wait for the re-run to redraw the rows: a selection made before it lands is on text it replaces.
  const unkeyedOrder = () => unkeyed.locator('p').allTextContents();
  const orderBefore = await unkeyedOrder();
  await doc.getByRole('button', { name: 'Reverse JSX rows', exact: true }).click();
  check(await holds(expect.poll(unkeyedOrder).not.toEqual(orderBefore)), 'reversing the rows redraws the unkeyed list');
  check(await holds(expect(unkeyed).toHaveAttribute('data-mx-annotated', '')), 'the unkeyed list itself stays commented after the reorder');
  check(await holds(expect(unkeyed.locator('[data-mx-comment-target], [data-mx-annotated]')).toHaveCount(0)),
    'no row of an unkeyed list carries a target or a pin');

  // ── a fresh launch: every pin reconnects ──
  await page.reload();
  check(await holds(doc.locator('td[data-mx-comment-owner="order-table"][data-mx-annotated]').filter({ hasText: 'Alice Chen' }).waitFor()),
    'the table-cell comment reconnects after a fresh launch');
  check(await holds(annotated(cardText)), 'the repeat comment reconnects after a fresh launch');
  check(await holds(expect(doc.locator('#index-cards')).toHaveAttribute('data-mx-annotated', '')), 'the unkeyed list comment reconnects after a fresh launch');
  check(await holds(expect(doc.locator('#index-cards [data-mx-comment-target], #index-cards [data-mx-annotated]')).toHaveCount(0)),
    '…still on the list owner, never a row');
  check((await annotations()).length === 3, 'all three comments persisted');

  // ── a saved markup comment must not steal the first click of a word selection ──
  await cardText.click();
  check(await holds(expect(page.getByLabel('Reply to annotation', { exact: true })).toHaveCount(0)), 'a click on a commented item opens no thread');
  check(await holds(expect(cardText).not.toHaveCSS('cursor', 'pointer')), 'a commented item shows no pointer cursor');
  await cardText.dblclick({ position: { x: 15, y: 8 } });
  check(await holds(expect(page.getByLabel('Reply to annotation', { exact: true })).toHaveCount(0)), 'a double-click to select its words opens no thread either');
  await doc.getByRole('button', { name: 'Comment on selected text', exact: true }).click();
  await save('Different words on an already commented markup node');
  check((await annotations()).some((item) => item.thread[0].body === 'Different words on an already commented markup node'),
    'different words on an already commented node take their own comment');
  await context.close();
}

run().then(() => check.done()).catch((err) => { console.error(err); process.exit(1); });
