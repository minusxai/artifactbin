import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
/**
 * THE EDITOR, end to end — the one editor there is.
 *
 * `services/app/lib/editor-v2` is the live engine: InPlaceEditor and the story
 * runtime's edit session import it, so what this gate drives in a real browser
 * is what a reader gets when they press Edit. Sections 1-3 are the engine's own
 * acceptance (native input, block structure, reversible layout, composition,
 * concurrency); section 4 is the human PATH around it — entering, the source
 * pane, version history, and a stranger who cannot save; section 5 is every WAY
 * OUT, because each leaves through a different code path and any of them can
 * lose what was typed on the way.
 *
 *   usage: node scripts/gate-editor-v2.mjs [base]
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { createChecker } from './lib/assert.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { becomeAccountOwner, becomeOwner, startDocument } from './lib/start-doc.mjs';
import { startMailSink, isSignedInAs } from './lib/mail-login.mjs';

const check = createChecker('editor');
/** A step whose failure invalidates every step after it: report it, then stop. */
const must = (condition, label) => { if (!check(condition, label)) throw new Error(label); };
const base = process.argv[2] ?? 'http://localhost:3030';
const st = await startDocument(base);
const api = (suffix = '', init = {}) =>
  fetch(`${base}/api/artifacts/${st.id}${suffix}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
  });
const source =
  '<div data-design="tw" className="p-10"><h1 id="title">Editor V2 acceptance</h1><p id="first" className="w-[600px] max-w-full">alpha first paragraph</p><p id="second">bravo second paragraph</p><Grid id="columns" mode="flow"><GridItem id="left" w={6}><p id="lp">Left column text</p></GridItem><GridItem id="right" w={6}><p id="rp">Right column text</p></GridItem></Grid><Grid id="tiles"><GridItem id="tilea" x={0} w={6} h={2}><p>First tile</p></GridItem><GridItem id="tileb" x={6} w={6} h={2}><p>Second tile</p></GridItem></Grid><pre id="code">code literal</pre><p id="remote">Remote marker</p></div>';
must((await api('', { method: 'PUT', body: JSON.stringify({ markup: source }) })).status === 200, 'the acceptance document publishes');
const browser = await chromium.launch();
const sink = await startMailSink();
const context = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await becomeOwner(page, base, st.token);
await page.goto(`${base}/a/${st.id}#edit`, { waitUntil: 'load' });
await page.getByRole('textbox', { name: 'Document text' }).first().waitFor({ timeout: 30000 });
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const head = async () => {
  const r = await api();
  must(r.status === 200, `the document reads back (${r.status})`);
  return r.json();
};
async function stored(predicate, label) {
  const deadline = Date.now() + 12000;
  let value;
  do {
    value = await head();
    if (predicate(value.markup)) {
      check(true, label);
      return value;
    }
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < deadline);
  check(false, `${label} (stored: ${String(value.markup).slice(0, 120)})`);
  return value;
}
async function range(startId, start, endId = startId, end = start) {
  await page.locator(`#${startId}`).scrollIntoViewIfNeeded();
  await page.evaluate(
    ({ startId, start, endId, end }) => {
      const a = document.getElementById(startId),
        b = document.getElementById(endId);
      const text = (element, index) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (index <= node.length) return [node, index];
          index -= node.length;
        }
        throw Error('bad text offset');
      };
      const [an, ao] = text(a, start),
        [bn, bo] = text(b, end);
      a.closest('.ProseMirror').focus({ preventScroll: true });
      const selection = getSelection();
      selection.removeAllRanges();
      selection.setBaseAndExtent(an, ao, bn, bo);
    },
    { startId, start, endId, end },
  );
  await page.waitForTimeout(40);
}
async function undo(predicate, label) {
  await page.keyboard.press(`${mod}+z`);
  return stored(predicate, label);
}
try {
  await range('first', 2, 'second', 3);
  await page.keyboard.type('X');
  await stored(
    (s) => s.includes('alXvo second paragraph') && !s.includes('id="second"'),
    'cross-paragraph replacement persists with survivor ID',
  );
  const originalClass = await page.locator('#first').getAttribute('class');
  await page.getByRole('button', { name: 'Increase font size', exact: true }).click();
  await stored((s) => /id="first"[^>]*text-/.test(s), 'block formatting after replacement');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction((cls) => document.getElementById('first')?.getAttribute('class') === cls, originalClass);
  await stored((s) => s.includes('alXvo second paragraph') && !/id="first"[^>]*text-/.test(s), 'button Undo removes only formatting');
  await undo(
    (s) => s.includes('alpha first paragraph') && s.includes('bravo second paragraph'),
    'Undo restores both paragraph identities',
  );
  const restoredSelection = await page.evaluate(() => {
    const s = getSelection();
    return {
      anchor: s.anchorNode.parentElement.closest('p')?.id,
      head: s.focusNode.parentElement.closest('p')?.id,
      from: s.anchorOffset,
      to: s.focusOffset,
    };
  });
  check(JSON.stringify(restoredSelection) === JSON.stringify({ anchor: 'first', head: 'second', from: 2, to: 3 }),
    `Undo puts the caret back where the edit was made (${JSON.stringify(restoredSelection)})`);
  await range('first', 0);
  await page.keyboard.type('!');
  await stored((s) => s.includes('!alpha first paragraph'), 'typing before rapid Undo');
  await page.getByRole('button', { name: 'Increase font size', exact: true }).click();
  await stored((s) => /id="first"[^>]*text-/.test(s), 'formatting before rapid Undo');
  await page.getByRole('button', { name: 'Undo', exact: true }).dblclick();
  await stored((s) => !s.includes('!alpha') && !/id="first"[^>]*text-/.test(s), 'rapid button Undo restores both actions');
  await range('first', 0, 'first', 5);
  await page.getByRole('button', { name: 'Toggle bold' }).click();
  await stored((s) => /<strong[^>]*>alpha<\/strong>/.test(s), 'top-bar formatting preserves range');
  check(await page.getByRole('button', { name: 'Toggle bold' }).getAttribute('aria-pressed') === 'true',
    'the bold control reports itself pressed for the selection');
  await undo((s) => !s.includes('<strong'), 'formatting is one undo action');
  await range('first', 0, 'first', 5);
  await page.evaluate(async () =>
    navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob(
          ['<p id="stolen" class="foreign" style="color:red"><strong>_literal_ *stars* | pipes # hashes</strong></p>'],
          { type: 'text/html' },
        ),
        'text/plain': new Blob(['_literal_ *stars* | pipes # hashes'], { type: 'text/plain' }),
      }),
    ]),
  );
  await page.keyboard.press(`${mod}+v`);
  await stored(
    (s) =>
      s.includes('_literal_ *stars* | pipes # hashes') &&
      !s.includes('stolen') &&
      !s.includes('foreign') &&
      !s.includes('color:red'),
    'HTML paste keeps literal punctuation and drops input properties',
  );
  await undo((s) => s.includes('alpha first paragraph'), 'HTML paste undoes in one step');
  await range('first', 0, 'first', 5);
  await page.getByRole('button', { name: 'Paste Markdown', exact: true }).click();
  await page.getByRole('textbox', { name: 'Markdown to insert' }).fill('**Markdown**\n\n- one\n  - nested');
  await page.getByRole('button', { name: 'Insert Markdown', exact: true }).click();
  await stored(
    (s) => s.includes('Markdown') && s.includes('<ul') && s.includes('nested'),
    'explicit Markdown uses structural list insertion',
  );
  await undo((s) => s.includes('alpha first paragraph') && !s.includes('nested'), 'Markdown paste undoes atomically');
  await range('code', 4);
  await page.evaluate(() => navigator.clipboard.writeText('**literal**'));
  await page.keyboard.press(`${mod}+v`);
  await stored((s) => s.includes('**literal**') && !s.includes('<strong'), 'code paste stays literal');
  await undo((s) => !s.includes('**literal**'), 'code paste undo');
  await range('first', 2);
  const blockedControls = await page.locator('[data-mx-node-chrome]').evaluate((root) =>
    [...root.querySelectorAll('button')].flatMap((button) => {
      const rect = button.getBoundingClientRect();
      if (!rect.width || !rect.height) return [];
      const hit = button.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit && button.contains(hit) ? [] : [button.getAttribute('aria-label')];
    }),
  );
  assert.deepEqual(blockedControls, [], 'every selection control receives clicks at its visible center');
  await page.getByRole('button', { name: 'Delete selected block', exact: true }).click();
  await stored((s) => !s.includes('id="first"'), 'selected trash control deletes exactly its source block');
  await undo((s) => s.includes('id="first"'), 'node deletion restores its identity');
  await range('first', 2);
  const handle = page.getByRole('button', { name: 'Resize block height', exact: true });
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await stored((s) => /id="first"[^>]*min-h-\[/.test(s), 'keyboard resize commits one explicit minimum height');
  await undo((s) => !/id="first"[^>]*min-h-\[/.test(s), 'resize undo');
  // A pointer preview is cancellable and never persists until release.
  await range('first', 2);
  const pointerHandle = page.getByRole('button', { name: 'Resize block height', exact: true });
  const bounds = await pointerHandle.boundingBox();
  const beforeCancel = (await head()).markup;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 70, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  check((await head()).markup === beforeCancel, 'a cancelled pointer resize writes nothing at all');
  await range('first',2);
  const corner=await page.getByRole('button',{name:'Resize selected block',exact:true}).boundingBox();
  const beforeResize=await head();
  await page.mouse.move(corner.x+corner.width/2,corner.y+corner.height/2);await page.mouse.down();
  await page.mouse.move(corner.x+corner.width/2+80,corner.y+corner.height/2+60,{steps:6});
  check((await head()).markup === beforeResize.markup, 'pointer preview does not save intermediate dimensions');
  await page.waitForFunction(() => Math.abs(document.getElementById('first').getBoundingClientRect().width-680)<2, undefined, {timeout:3000});

  check(Math.abs((await page.locator('#first').boundingBox()).width - 680) < 2, 'content reflows during the resize preview');
  await page.mouse.up();
  const resized=await stored(s=>/id="first"[^>]*w-\[680px\]/.test(s)&&/id="first"[^>]*min-h-\[/.test(s),'pointer drag changes width and height');
  check(resized.version === beforeResize.version + 1, 'one resize gesture creates one saved version');
  await undo(s=>/id="first"[^>]*w-\[600px\]/.test(s)&&!/id="first"[^>]*min-h-\[/.test(s),'pointer resize undoes both dimensions together');
  await range('first', 2);
  const move = page.getByRole('button', { name: 'Move selected block', exact: true });
  const grip = await move.boundingBox(), destination = await page.locator('#second').boundingBox();
  const beforeMove = await head();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5, {steps:4});
  await page.locator('[data-mx-drag-preview][data-mx-drop-valid="false"]').waitFor({state:'visible'});
  check(await page.locator('[data-mx-drag-preview]').textContent() === '', 'invalid drag feedback contains no text');
  check(await page.locator('[data-mx-drop-marker]').isVisible() === false, 'and offers no insertion marker');
  await page.mouse.up();
  check((await head()).markup === beforeMove.markup, 'invalid drop does not edit source');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x + 20, destination.y + destination.height / 2, {steps:6});
  await page.locator('[data-mx-drag-preview][data-mx-drop-valid="true"]').waitFor({state:'visible'});
  check(await page.locator('[data-mx-drag-preview]').textContent() === '', 'valid drag feedback contains no text');
  await page.locator('[data-mx-drop-marker]').waitFor({state:'visible'});
  check((await head()).markup === beforeMove.markup, 'drag feedback does not edit source');
  await page.mouse.up();
  await stored(s=>s.indexOf('id="second"')<s.indexOf('id="first"'), 'pointer drop follows the visible insertion marker');
  check(await page.locator('[data-mx-drag-preview]').isVisible() === false, 'and the preview disappears on release');
  await undo(s=>s.indexOf('id="first"')<s.indexOf('id="second"'), 'pointer move undoes in one step');
  await range('first', 2);
  await move.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await stored(
    (s) => s.indexOf('id="second"') < s.indexOf('id="first"'),
    'dedicated grip moves a block without changing identity',
  );
  await undo((s) => s.indexOf('id="first"') < s.indexOf('id="second"'), 'move undo restores source order');
  await range('second', 4, 'lp', 5);
  await page.waitForFunction(() => getSelection().toString().includes('Left '));
  check(await page.locator('[data-mx-node-chrome]').isVisible() === false, 'text selection has no container resize controls');
  await page.locator('#second').hover();
  check(await page.locator('#second').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgba(245, 158, 11, 0.08)', 'hover uses the shared subtle amber tint');
  check(await page.locator('#second').evaluate(el => getComputedStyle(el).outlineWidth) === '1px', 'hover uses the shared thin outline');
  await page.mouse.move(0, 0);
  check(await page.locator('#second').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgba(0, 0, 0, 0)',
    'block selection does not flood the text background');
  await page.keyboard.press('Escape');
  await range('first', 2);
  const narrowHandle = await page.getByRole('button', {name:'Resize block width',exact:true}).boundingBox();
  await page.mouse.move(narrowHandle.x+narrowHandle.width/2,narrowHandle.y+narrowHandle.height/2);
  await page.mouse.down();
  await page.mouse.move(narrowHandle.x+narrowHandle.width/2-180,narrowHandle.y+narrowHandle.height/2,{steps:8});
  await page.waitForFunction(() => Math.abs(document.getElementById('first').getBoundingClientRect().width-420)<2, undefined, {timeout:3000});
  check(Math.abs((await page.locator('#first').boundingBox()).width - 420) < 2, 'shrinking reflows text before release');
  await page.evaluate(() => window.scrollBy(0,20));
  check(Math.abs((await page.locator('#first').boundingBox()).width - 420) < 2, 'scroll does not reset the active preview');
  await page.mouse.up();
  await stored(s=>/id="first"[^>]*w-\[420px\]/.test(s),'shrinking saves the previewed width');
  await undo(s=>/id="first"[^>]*w-\[600px\]/.test(s),'shrinking remains one undo action');
  await range('lp', 2);
  await page.getByRole('button', { name: 'Select GridItem', exact: true }).click();
  const divider = page.getByRole('button', { name: 'Resize adjacent columns', exact: true });
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await stored(
    (s) => /id="left" w=\{7\}/.test(s) && /id="right" w=\{5\}/.test(s),
    'paired divider preserves the row total',
  );
  await undo(
    (s) => /id="left" w=\{6\}/.test(s) && /id="right" w=\{6\}/.test(s),
    'paired divider undo restores both columns',
  );
  await range('lp', 16);
  await page.keyboard.press('Shift+ArrowRight');
  await page.locator('[data-mx-block-status]').waitFor({ state: 'visible' });
  await page.keyboard.type('MUST_NOT_INSERT');
  check(await page.locator('#lp').textContent() === 'Left column text', 'typing across two columns inserts nothing into either');
  await page.keyboard.press('Delete');
  await stored(
    (s) =>
      !s.includes('Left column text') &&
      !s.includes('Right column text') &&
      s.includes('id="left"') &&
      s.includes('id="right"'),
    'cross-column block deletion preserves empty column containers',
  );
  await undo((s) => s.includes('Left column text') && s.includes('Right column text'), 'cross-column deletion undo');
  const beforePhone = (await head()).markup;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  for (const [first, second] of [
    ['left', 'right'],
    ['tilea', 'tileb'],
  ]) {
    const a = await page.locator(`#${first}`).boundingBox(),
      b = await page.locator(`#${second}`).boundingBox();
    check(Math.abs(a.width - b.width) < 2 && b.y >= a.y + a.height - 2, `${first}/${second} stack at phone width`);
  }
  check((await head()).markup === beforePhone, 'flow and positioned Grid stack on phones without a source edit');
  await page.setViewportSize({ width: 1400, height: 1000 });
  // An accepted response carrying a concurrent edit must wait for active composition.
  let releaseResponse, requestReady;
  const hold = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  const ready = new Promise((resolve) => {
    requestReady = resolve;
  });
  await page.route(
    `**/api/my/artifacts/${st.id}/edits`,
    async (route) => {
      const remote = await head();
      must((await api('/edits', {
        method: 'POST',
        body: JSON.stringify({ edit_id: remote.edit_id, old_string: 'Remote marker', new_string: 'Remote changed' }),
      })).status === 200, 'the concurrent agent edit applies while the save is in flight');
      const response = await route.fetch();
      requestReady();
      await hold;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await range('first', 0);
  await page.keyboard.type('!');
  await ready;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '日本語', selectionStart: 3, selectionEnd: 3 });
  releaseResponse();
  check(await page.locator('#remote').textContent() === 'Remote marker', 'accepted remote source waits for composition');
  await cdp.send('Input.insertText', { text: '日本語' });
  await stored(
    (s) => s.includes('日本語') && s.includes('Remote changed'),
    'composition and concurrent accepted source both persist',
  );
  await page.getByText('Remote changed', { exact: true }).waitFor();
  await undo((s) => !s.includes('日本語') && s.includes('Remote changed'), 'Undo preserves an unrelated remote edit');
  await page.getByRole('button', { name: 'Exit edit mode' }).click();
  await page.reload();
  await page.getByText('Remote changed', { exact: true }).waitFor();
  check(await page.locator('.ProseMirror').count() === 0, 'a saved document reloads READ-ONLY');
  check(errors.length === 0, `and the browser reported no error on the way (${errors.slice(0, 2).join('; ') || 'none'})`);
  const extended =
    '<div className="p-10"><Grid mode="flow" id="three"><GridItem id="c1" w={4}><p id="a1">one</p></GridItem><GridItem id="c2" w={4}><p id="a2">two</p></GridItem><GridItem id="c3" w={4}><p id="a3">three</p></GridItem></Grid><table><tbody><tr><td><p id="cell1">first cell</p></td><td><p id="cell2">second cell</p></td></tr></tbody></table>' +
    Array.from(
      { length: 300 },
      (_, i) => `<p id="long${i}">Paragraph ${i}: ${'bounded performance fixture '.repeat(8)}</p>`,
    ).join('') +
    '</div>';
  must((await api('', { method: 'PUT', body: JSON.stringify({ markup: extended }) })).status === 200, 'the 300-paragraph fixture publishes');
  await page.goto('about:blank');
  const entered = Date.now();
  await page.goto(`${base}/a/${st.id}#edit`, { waitUntil: 'load' });
  await page.getByRole('textbox', { name: 'Document text' }).first().waitFor();
  check.note(`300-paragraph editor ready in ${Date.now() - entered}ms including navigation`);
  must((await head()).markup.includes('id="a3"'), 'the three-column fixture is what the editor opened');
  await range('a3', 4, 'a1', 1);
  await page.locator('[data-mx-block-status]').waitFor({ state: 'visible' });
  check(await page.locator('[data-mx-block-selected]').count() === 3, 'a backward selection across three columns selects three blocks');
  await page.keyboard.press('Delete');
  await stored(
    (s) =>
      !s.includes('id="a1"') &&
      !s.includes('id="a2"') &&
      !s.includes('id="a3"') &&
      ['c1', 'c2', 'c3'].every((id) => s.includes(`id="${id}"`)),
    'backward three-column selection retains all containers',
  );
  await undo((s) => s.includes('id="a1"') && s.includes('id="a3"'), 'three-column undo');
  await range('cell1', 2);
  await page.keyboard.type('X');
  await stored((s) => s.includes('fiXrst cell'), 'single-cell editing');
  await undo((s) => s.includes('first cell') && !s.includes('fiXrst'), 'single-cell undo');
  await range('cell1', 1, 'cell2', 3);
  await page.keyboard.type('BLOCKED');
  check(await page.locator('#cell1').textContent() === 'first cell'
    && await page.locator('#cell2').textContent() === 'second cell',
  'typing across two table cells writes into neither');
  await page.getByRole('alert').filter({ hasText: 'Edit one table cell at a time' }).waitFor();
  await range('long150', 12);
  const began = Date.now();
  await page.keyboard.type('X');
  await page.waitForFunction(() => document.getElementById('long150').textContent.includes('X'));
  const latency = Date.now() - began;
  check(latency < 2000, `input stays responsive in a 300-paragraph document (${latency}ms to paint)`);
  await stored((s) => /id="long150"[^>]*>[^<]*X/.test(s), 'large document edit persists');
  await page.getByRole('button', { name: 'Exit edit mode' }).click();
  check(errors.length === 0, `the whole pass reported no browser error (${errors.slice(0, 2).join('; ') || 'none'})`);

  /* ── 4. THE HUMAN PATH AROUND THE ENGINE ──────────────────────────────────
   *
   * Everything above opens the editor by deep link and drives the engine. This
   * is how a person actually gets there and what surrounds them once they are:
   * a reader is offered no editing at all, `#edit` is a MODE of the same URL,
   * the source pane is a real editor served from our own origin, the version
   * history clears both bars at every width, somebody holding a credential for
   * a DIFFERENT document is offered nothing — and an account that owns the
   * document edits it through its session with no credential in the browser.
   */
  {
    const human = await startDocument(base);
    const humanApi = (suffix = '', init = {}) => fetch(`${base}/api/artifacts/${human.id}${suffix}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${human.token}` },
    });
    const dataset = await (await fetch(`${base}/api/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${human.token}` },
      body: JSON.stringify({ title: 'Editor gate dataset', dataset: [
        { region: 'EU', month: '2026-01-01', revenue: 120 }, { region: 'NA', month: '2026-01-01', revenue: 180 },
        { region: 'EU', month: '2026-02-01', revenue: 150 }, { region: 'NA', month: '2026-02-01', revenue: 210 },
      ] }),
    })).json();
    const humanMarkup = `<Helmet>
<Value name="region" type="string" />
<Query name="sales" source="ref:${dataset.id}">{\`select * from public.rows where $region is null or region = $region\`}</Query>
</Helmet><div data-design="tw" className="@container p-10">
<h1 className="text-4xl font-bold tracking-tight">Editor gate</h1>
<p className="mt-4">Total: <Number data="$sales" col="revenue" agg="sum" prefix="$" /></p>
<div className="mt-6 h-72 flex min-h-0 flex-col"><Question title="Revenue" data="$sales" viz={{kind:"vega-lite", spec:{mark:"bar", encoding:{x:{field:"month",type:"temporal"}, y:{field:"revenue",type:"quantitative"}}}}} /></div>
</div>`;
    must((await humanApi('', { method: 'PUT', body: JSON.stringify({ title: 'Editor gate', markup: humanMarkup }) })).status === 200,
      'the human-path document publishes');

    const reader = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const readerPage = await reader.newPage();
    await readerPage.goto(`${base}/a/${human.id}`, { waitUntil: 'load' });
    await readerPage.waitForTimeout(2000);
    // No credential in this browser: the viewer bar is owner chrome and must
    // not render. The way into edit mode without it is the #edit fragment.
    check((await readerPage.locator('[aria-label="Edit this document"]').count()) === 0,
      'a reader with no credential sees no edit chrome');
    await readerPage.goto(`${base}/a/${human.id}#edit`);
    await readerPage.waitForTimeout(2500);
    check(readerPage.url().includes(`/a/${human.id}`) && readerPage.url().endsWith('#edit'),
      `Edit stays on the same url, as a mode (${readerPage.url()})`);
    await reader.close();

    const humanCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const humanPage = await humanCtx.newPage();
    await becomeOwner(humanPage, base, human.token);
    await humanPage.goto(`${base}/a/${human.id}#edit`, { waitUntil: 'load' });
    await humanPage.waitForTimeout(4500);
    check((await humanPage.mainFrame().locator('svg.marks, canvas').count()) > 0, 'embeds render inside the editor');
    check((await humanPage.locator('[aria-label="Save"]').count()) === 0, 'the editor has no Save button');

    // History must start below both fixed bars, including after a resize.
    await humanPage.getByRole('button', { name: 'Open version history', exact: true }).click();
    for (const viewport of [{ width: 1400, height: 950 }, { width: 900, height: 700 }]) {
      await humanPage.setViewportSize(viewport);
      const history = humanPage.getByRole('complementary', { name: 'Version history' });
      const toolbar = await humanPage.getByRole('banner', { name: 'Editor toolbar' }).boundingBox();
      const drawer = await history.boundingBox();
      const current = await history.getByRole('button', { name: 'Show the current version' }).boundingBox();
      check(!!toolbar && !!drawer && drawer.y >= toolbar.y + toolbar.height,
        `history clears both toolbars at ${viewport.width}px`);
      check(!!current && !!drawer && current.y >= drawer.y && drawer.y + drawer.height <= viewport.height + 1,
        `current version and drawer fit below the bars at ${viewport.width}px`);
      const close = history.getByRole('button', { name: 'Close version history' });
      check(await close.click({ trial: true, timeout: 2000 }).then(() => true, () => false),
        `history close button is not covered at ${viewport.width}px`);
    }
    await humanPage.setViewportSize({ width: 390, height: 844 });
    const sheet = humanPage.getByRole('dialog', { name: 'Version history' });
    await sheet.waitFor({ state: 'visible' });
    check(await sheet.getByRole('button', { name: 'Show the current version' }).isVisible(),
      'phone history keeps the current version visible in its bottom sheet');
    await sheet.getByRole('button', { name: 'Close version history' }).click();
    check(await humanPage.getByRole('button', { name: 'Open version history' }).getAttribute('aria-expanded') === 'false',
      'phone history close button remains usable');
    // Escape also works on a broken layout, so a failed geometry check cannot stall the gate.
    await humanPage.keyboard.press('Escape');
    await humanPage.setViewportSize({ width: 1400, height: 950 });

    // Idle must not spend versions: nothing typed ⇒ nothing written.
    const quiet = (await (await humanApi()).json()).version;
    await humanPage.waitForTimeout(2000);
    check((await (await humanApi()).json()).version === quiet, 'an idle editor writes nothing');

    /*
     * THE SOURCE PANE. `@monaco-editor/react` does not bundle Monaco: left to
     * itself it injects a <script> pointing at jsdelivr, and the app's own CSP
     * (`script-src 'self'`) refuses it — so `code` mode showed "Loading…"
     * forever, in development and on the deployment alike, and nothing in the
     * unit suite could see it (the editor's UI test mocks the package, so the
     * loader never runs there).
     */
    const offOrigin = [];
    const cspErrors = [];
    humanPage.on('requestfailed', (r) => { if (!r.url().startsWith(base)) offOrigin.push(`${r.url()} (${r.failure()?.errorText})`); });
    humanPage.on('request', (r) => { if (r.resourceType() === 'script' && !r.url().startsWith(base)) offOrigin.push(r.url()); });
    humanPage.on('console', (m) => { if (m.type() === 'error' && /violates the following Content Security Policy directive: "script-src/.test(m.text())) cspErrors.push(m.text()); });

    await humanPage.goto(`${base}/a/${human.id}#edit`, { waitUntil: 'load' });
    await humanPage.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });
    await humanPage.waitForTimeout(2500);
    let releaseRichEditor;
    const richEditorDownload = new Promise((resolve) => { releaseRichEditor = resolve; });
    await humanPage.route('**/assets/SourceEditor-*.js', async (route) => { await richEditorDownload; await route.continue(); });
    await humanPage.click('[aria-label="Edit the source"]');
    const plainSource = humanPage.locator('textarea[aria-label="Markup source"]');
    await plainSource.waitFor();
    const initialSource = await plainSource.inputValue();
    check(initialSource.includes('Editor gate'), 'a slow rich-editor download still presents the complete source');
    // React replaces the initial textarea when the lazy editor starts loading, so a
    // one-shot evaluate can read the detached node; a locator assertion re-resolves it.
    await expect(plainSource).toHaveCSS('background-color', 'rgb(30, 30, 30)');
    await expect(plainSource).toHaveCSS('color', 'rgb(212, 212, 212)');
    check(true, 'the immediately editable fallback uses Monaco’s dark palette');
    await plainSource.fill(initialSource.replace('Editor gate', 'Edited while rich editor loads'));
    releaseRichEditor();
    check(await humanPage.waitForSelector('.monaco-editor [aria-label="Markup source"]', { timeout: 30_000 })
      .then(() => true, () => false), 'the source pane mounts a real editor, not a permanent "Loading…"');
    const editorPaint = await humanPage.locator('.monaco-editor').evaluate((editor) => {
      const input = editor.querySelector('textarea');
      return {
        background: getComputedStyle(editor).backgroundColor,
        inputPosition: input && getComputedStyle(input).position,
        localStyles: !!editor.getRootNode().querySelector('[data-source-editor-styles]'),
        height: editor.getBoundingClientRect().height,
      };
    });
    check(editorPaint.localStyles && editorPaint.background !== 'rgba(0, 0, 0, 0)'
      && editorPaint.inputPosition === 'absolute' && editorPaint.height > 200,
    'rich editor has shadow-local styles, opaque paint, clipped input and usable height');
    check(await humanPage.locator('.monaco-editor').evaluate((editor) => new Promise((resolve) => {
      // TrustedUi has its own focus scope, and modern Monaco uses EditContext's
      // div rather than its compatibility textarea for keyboard input.
      if (editor.contains(editor.getRootNode().activeElement)) return resolve(true);
      const done = () => { clearTimeout(timer); editor.removeEventListener('focusin', done); resolve(true); };
      const timer = setTimeout(() => { editor.removeEventListener('focusin', done); resolve(false); }, 5000);
      editor.addEventListener('focusin', done);
    })), 'rich-editor handoff preserves keyboard focus');
    check((await humanPage.locator('[aria-label="Source pane"]').getByText('Loading...').count()) === 0,
      'and the loading placeholder is gone');
    /*
     * The pane is the document's own markup, not an empty buffer. Two things
     * make a naive substring check lie: Monaco paints U+00A0 for every space,
     * and it renders only the LINES on screen (and only the visible span of a
     * long one). What holds regardless: it is showing this document, from the
     * top.
     */
    const flat = (t) => t.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const lines = await humanPage.locator('[aria-label="Source pane"] .view-line').allTextContents();
    const storedSource = flat((await (await humanApi()).json()).markup);
    check(lines.length >= 3 && storedSource.startsWith(flat(lines[0])) && flat(lines[0]).length > 0,
      `the pane carries the document source (${lines.length} lines from ${JSON.stringify(flat(lines[0] ?? '').slice(0, 30))})`);
    check(offOrigin.length === 0, `the editor loads no off-origin script (${offOrigin.slice(0, 2).join(', ') || 'none'})`);
    check(cspErrors.length === 0, `and trips no CSP directive (${cspErrors.slice(0, 1).join(' ') || 'none'})`);

    /*
     * AND TYPING INTO IT MUST NOT LOSE CHARACTERS. A controlled <Editor value>
     * is a race: every keystroke sets React state, and a render one keystroke
     * behind pushes that STALE string back into Monaco's model. Measured before
     * the fix, at full speed: "typed in code mode" reached the server as
     * "typemode", while the same words at 150ms a key arrived whole — which is
     * why no hand test would ever have found it. So: no delay, exact compare.
     */
    const typed = ' plus fast typing';
    await humanPage.keyboard.type(typed);
    await humanPage.waitForTimeout(4000);
    const afterTyping = (await (await humanApi()).json()).markup;
    check(afterTyping.endsWith(typed), `fast typing in the code pane loses nothing (…${JSON.stringify(afterTyping.slice(-24))})`);
    check(afterTyping.includes('Edited while rich editor loads'), 'edits made during the download survive handoff and reach storage');

    // Local typing must not move the model, and a replacement from OUTSIDE still must.
    const paneHead = await (await humanApi()).json();
    await humanApi('/edits', {
      method: 'POST',
      body: JSON.stringify({ edit_id: paneHead.edit_id, old_string: 'Total:', new_string: 'Agent wrote while code was open:' }),
    });
    await humanPage.waitForTimeout(6000);
    const paneAfter = ((await humanPage.locator('[aria-label="Source pane"] .view-lines').textContent().catch(() => '')) ?? '')
      .replace(/ /g, ' ');
    check(paneAfter.includes('Agent wrote while code was open:'), 'and the open code pane still adopts an agent edit');

    // Formatting is a read-only projection, never a source edit or a model reset.
    const beforePreview = await (await humanApi()).json();
    await humanPage.locator('.monaco-editor').evaluate((el) => { window.__originalSourceEditor = el; });
    await humanPage.getByRole('button', { name: 'View formatted', exact: true }).click();
    await humanPage.locator('.monaco-editor [aria-label="Formatted JSX"]').waitFor();
    check(await humanPage.getByText('Formatted preview · read-only', { exact: true }).isVisible(),
      'formatted source is explicitly read-only');
    check(await humanPage.locator('.monaco-editor:visible .view-line').count() > 1, 'the preview shows formatted JSX');
    await humanPage.getByRole('button', { name: 'Edit source', exact: true }).click();
    check(await humanPage.locator('.monaco-editor:visible').evaluate((el) => el === window.__originalSourceEditor),
      'returning to source preserves the original editor and undo model');
    const afterPreview = await (await humanApi()).json();
    check(afterPreview.markup === beforePreview.markup && afterPreview.edit_id === beforePreview.edit_id,
      'viewing formatted JSX does not write a new source or edit');

    /*
     * A credential for a DIFFERENT document must not open a working editor. The
     * editor is seeded from the page for speed, so without the ownership check
     * first, a visitor holding someone else's credential gets a full editor
     * whose every save fails.
     */
    const strangerCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const stranger = await strangerCtx.newPage();
    const otherDocument = await startDocument(base);
    await becomeOwner(stranger, base, otherDocument.token);
    await stranger.goto(`${base}/a/${human.id}#edit`, { waitUntil: 'load' });
    await stranger.waitForTimeout(4500);
    check((await stranger.locator('[aria-label="Exit edit mode"]').count()) === 0,
      'no editor chrome is offered to someone who cannot save');
    check((await stranger.locator('[aria-label="Edit this document"], [aria-label="Edit artifact"]').count()) === 0,
      'nor any other owner affordance');
    await strangerCtx.close();
    await humanCtx.close();

    /*
     * AND AS AN ACCOUNT. There is no separate signup: a verified code for an
     * unknown address creates the account. The account then publishes through
     * `/api/my/artifacts` — the door the app's own UI uses — so nothing in this
     * browser ever holds a bearer secret, and the editor has to save through
     * the session alone.
     */
    const accountCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const accountPage = await accountCtx.newPage();
    const email = `mxmx_test_editor_${Date.now().toString(36)}@example.com`;
    const account = await becomeAccountOwner(accountPage, base, { sink, email });
    check(await isSignedInAs(accountPage, email), 'logging in with a code signs you in');
    const owned = await account.publish({ title: 'Session edited', markup: '<div className="p-10"><h1>Session edited</h1></div>' });
    await accountPage.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await accountPage.waitForTimeout(1200);
    check((await accountPage.getByText('Session edited', { exact: false }).count()) > 0,
      'the account’s document appears on its dashboard');
    await accountPage.goto(`${base}/a/${owned.id}#edit`, { waitUntil: 'load' });
    await accountPage.waitForTimeout(4500);
    check((await accountPage.locator('[aria-label="Owning token"]').count()) === 0,
      'a signed-in owner opens the editor with nothing to paste');
    const accountFrame = accountPage.mainFrame();
    await accountFrame.locator('h1').first().click({ clickCount: 3 });
    await accountPage.keyboard.type('Edited by the session');
    // Blurred, not clicked away: selecting the heading pops the typography bar.
    await accountFrame.locator('h1').first().evaluate((el) => el.blur());
    await accountPage.waitForTimeout(3000);
    const sessionStored = await accountPage.evaluate(async (id) => (await (await fetch(`/api/my/artifacts/${id}`)).json()), owned.id);
    check((sessionStored.markup ?? '').includes('Edited by the session'),
      'session-authed editing persists through /api/my/artifacts/<id>/edits with no save');
    await accountCtx.close();
  }

  /* ── 5. EVERY WAY OUT ─────────────────────────────────────────────────────
   *
   * The fault this pins: the editor saves on a 500 ms debounce and `done`
   * called onExit directly, which unmounts the editor — and the unmount runs
   * the debounce effect's cleanup, cancelling the save. Typing and leaving
   * inside half a second sent NOTHING (measured: zero requests to /edits) while
   * the status chip still read `saved`. Every unit test passed through it,
   * because in jsdom nothing unmounts unless a test says so.
   *
   * So each way out is exercised separately — done, the back button, a hidden
   * tab — and the PAIR of `done` cases is the evidence: same clicks, only the
   * pause differs, so "it saved with a pause" proves the save path works and
   * isolates the exit as the thing that lost it.
   */
  {
    const EXIT_DOC = '<div data-design="tw" className="p-10">'
      + '<h1 className="text-4xl font-bold">Original heading</h1>'
      + '<p className="mt-4 text-lg">Body copy.</p></div>';

    async function typeAndLeave({ pause, stamp, leaveBy = 'done' }) {
      const st = await startDocument(base);
      await fetch(`${base}/api/artifacts/${st.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
        body: JSON.stringify({ title: 'exit gate', markup: EXIT_DOC, theme: 'manuscript' }),
      });
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const posts = [];
      page.on('request', (r) => { if (r.url().includes('/edits')) posts.push(r.url()); });
      await becomeOwner(page, base, st.token);
      if (leaveBy === 'back') {
        // Enter the way a person does, so the history entry `back` undoes is
        // the one the page pushed. A deep link to #edit has nothing to go back to.
        await page.goto(`${base}/a/${st.id}`, { waitUntil: 'load' });
        // Reading is chromeless until the artifact controls are revealed, and
        // the owner rail is decided client-side, so the control appears a beat
        // after load — a fixed pause here is a flake on a cold server.
        await openArtifactControls(page);
        await page.locator('[aria-label="Edit artifact"]').first().click({ timeout: 30_000 });
      } else {
        await page.goto(`${base}/a/${st.id}#edit`, { waitUntil: 'load' });
      }
      await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 90_000 });
      // The canvas mounts after the editor bar; typing before it exists types
      // into nothing and would report a loss that never happened.
      await page.waitForTimeout(3000);
      const frame = page.mainFrame();
      await frame.waitForFunction(() => !!document.querySelector('h1')?.isContentEditable, null, { timeout: 60_000 });
      await frame.evaluate(() => {
        const h = document.querySelector('h1');
        h.focus();
        const r = document.createRange(); r.selectNodeContents(h); r.collapse(false);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      });
      await page.keyboard.type(stamp);
      const inDocument = await page.mainFrame().evaluate(() => document.querySelector('h1')?.textContent ?? '');
      must(inDocument.includes(stamp.trim()),
        `the ${leaveBy} case could type into the document (heading reads ${JSON.stringify(inDocument)})`);

      if (pause) await page.waitForTimeout(pause);
      if (leaveBy === 'done') {
        await page.click('[aria-label="Exit edit mode"]');
        // Far longer than the debounce, so a merely SLOW save still counts as
        // saved — only one that never left the browser fails here.
        await page.waitForTimeout(5000);
      } else if (leaveBy === 'back') {
        // The browser's own back button. It never touches the done handler: the
        // page hears a hashchange and unmounts the editor, debounce and all.
        await page.goBack();
        await page.waitForTimeout(5000);
      } else {
        /*
         * The tab going away: same loss, no click to hang the save on. The wait
         * is capped BELOW the debounce (500ms) on purpose — past it, the timer
         * itself would be what saved the document.
         */
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForResponse((r) => r.url().includes('/edits'), { timeout: 400 }).catch(() => {});
        await page.goto('about:blank');
        await page.waitForTimeout(1500);
      }

      const row = await (await fetch(`${base}/api/artifacts/${st.id}`, {
        headers: { Authorization: `Bearer ${st.token}` },
      })).json();
      await page.close();
      return { saved: (row.markup ?? '').includes(stamp.trim()), version: row.version, posts: posts.length };
    }

    const paused = await typeAndLeave({ pause: 2500, stamp: ' PAUSED' });
    check(paused.saved, `typing then waiting saves (v${paused.version}, ${paused.posts} POST)`);
    const fast = await typeAndLeave({ pause: 0, stamp: ' FAST' });
    check(fast.saved, `typing then pressing done AT ONCE saves (v${fast.version}, ${fast.posts} POST)`);
    check(fast.posts > 0, 'and `done` actually sent something (0 requests was the bug)');
    const back = await typeAndLeave({ pause: 0, stamp: ' BACK', leaveBy: 'back' });
    check(back.saved, `the browser back button saves too (v${back.version}, ${back.posts} POST)`);
    const hidden = await typeAndLeave({ pause: 0, stamp: ' HIDDEN', leaveBy: 'hide' });
    check(hidden.saved, `a hidden tab drains too (v${hidden.version}, ${hidden.posts} POST)`);
  }
} finally {
  await browser.close();
  sink.close();
}
check.done();
