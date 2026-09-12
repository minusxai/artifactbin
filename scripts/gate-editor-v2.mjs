import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
/** Editor V2 production acceptance: native input, source persistence and reversible layout. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';
const base = process.argv[2] ?? 'http://localhost:3030';
const st = await startDocument(base);
const api = (suffix = '', init = {}) =>
  fetch(`${base}/api/artifacts/${st.id}${suffix}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
  });
const source =
  '<div data-design="tw" className="p-10"><h1 id="title">Editor V2 acceptance</h1><p id="first" className="w-[600px] max-w-full">alpha first paragraph</p><p id="second">bravo second paragraph</p><Grid id="columns" mode="flow"><GridItem id="left" w={6}><p id="lp">Left column text</p></GridItem><GridItem id="right" w={6}><p id="rp">Right column text</p></GridItem></Grid><Grid id="tiles"><GridItem id="tilea" x={0} w={6} h={2}><p>First tile</p></GridItem><GridItem id="tileb" x={6} w={6} h={2}><p>Second tile</p></GridItem></Grid><pre id="code">code literal</pre><p id="remote">Remote marker</p></div>';
assert.equal((await api('', { method: 'PUT', body: JSON.stringify({ markup: source }) })).status, 200);
const browser = await chromium.launch();
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
  assert.equal(r.status, 200);
  return r.json();
};
async function stored(predicate, label) {
  const deadline = Date.now() + 12000;
  let value;
  do {
    value = await head();
    if (predicate(value.markup)) {
      console.log(`  ok ${label}`);
      return value;
    }
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < deadline);
  assert.fail(`${label}: ${value.markup}`);
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
  assert.deepEqual(
    await page.evaluate(() => {
      const s = getSelection();
      return {
        anchor: s.anchorNode.parentElement.closest('p')?.id,
        head: s.focusNode.parentElement.closest('p')?.id,
        from: s.anchorOffset,
        to: s.focusOffset,
      };
    }),
    { anchor: 'first', head: 'second', from: 2, to: 3 },
  );
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
  assert.equal(await page.getByRole('button', { name: 'Toggle bold' }).getAttribute('aria-pressed'), 'true');
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
  assert.equal((await head()).markup, beforeCancel);
  await range('first',2);
  const corner=await page.getByRole('button',{name:'Resize selected block',exact:true}).boundingBox();
  const beforeResize=await head();
  await page.mouse.move(corner.x+corner.width/2,corner.y+corner.height/2);await page.mouse.down();
  await page.mouse.move(corner.x+corner.width/2+80,corner.y+corner.height/2+60,{steps:6});
  assert.equal((await head()).markup,beforeResize.markup,'pointer preview does not save intermediate dimensions');
  await page.waitForFunction(() => Math.abs(document.getElementById('first').getBoundingClientRect().width-680)<2, undefined, {timeout:3000});

  assert.ok(Math.abs((await page.locator('#first').boundingBox()).width-680)<2,'content reflows during the resize preview');
  await page.mouse.up();
  const resized=await stored(s=>/id="first"[^>]*w-\[680px\]/.test(s)&&/id="first"[^>]*min-h-\[/.test(s),'pointer drag changes width and height');
  assert.equal(resized.version,beforeResize.version+1,'one resize gesture creates one saved version');
  await undo(s=>/id="first"[^>]*w-\[600px\]/.test(s)&&!/id="first"[^>]*min-h-\[/.test(s),'pointer resize undoes both dimensions together');
  await range('first', 2);
  const move = page.getByRole('button', { name: 'Move selected block', exact: true });
  const grip = await move.boundingBox(), destination = await page.locator('#second').boundingBox();
  const beforeMove = await head();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5, {steps:4});
  await page.locator('[data-mx-drag-preview][data-mx-drop-valid="false"]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-mx-drag-preview]').textContent(), '', 'invalid drag feedback contains no text');
  assert.equal(await page.locator('[data-mx-drop-marker]').isVisible(), false);
  await page.mouse.up();
  assert.equal((await head()).markup, beforeMove.markup, 'invalid drop does not edit source');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x + 20, destination.y + destination.height / 2, {steps:6});
  await page.locator('[data-mx-drag-preview][data-mx-drop-valid="true"]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-mx-drag-preview]').textContent(), '', 'valid drag feedback contains no text');
  await page.locator('[data-mx-drop-marker]').waitFor({state:'visible'});
  assert.equal((await head()).markup, beforeMove.markup, 'drag feedback does not edit source');
  await page.mouse.up();
  await stored(s=>s.indexOf('id="second"')<s.indexOf('id="first"'), 'pointer drop follows the visible insertion marker');
  assert.equal(await page.locator('[data-mx-drag-preview]').isVisible(), false);
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
  assert.equal(await page.locator('[data-mx-node-chrome]').isVisible(), false, 'text selection has no container resize controls');
  assert.equal(await page.locator('#second').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'block selection does not flood the text background');
  await page.keyboard.press('Escape');
  await range('first', 2);
  const narrowHandle = await page.getByRole('button', {name:'Resize block width',exact:true}).boundingBox();
  await page.mouse.move(narrowHandle.x+narrowHandle.width/2,narrowHandle.y+narrowHandle.height/2);
  await page.mouse.down();
  await page.mouse.move(narrowHandle.x+narrowHandle.width/2-180,narrowHandle.y+narrowHandle.height/2,{steps:8});
  await page.waitForFunction(() => Math.abs(document.getElementById('first').getBoundingClientRect().width-420)<2, undefined, {timeout:3000});
  assert.ok(Math.abs((await page.locator('#first').boundingBox()).width-420)<2, 'shrinking reflows text before release');
  await page.evaluate(() => window.scrollBy(0,20));
  assert.ok(Math.abs((await page.locator('#first').boundingBox()).width-420)<2, 'scroll does not reset the active preview');
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
  assert.equal(await page.locator('#lp').textContent(), 'Left column text');
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
    assert.ok(Math.abs(a.width - b.width) < 2 && b.y >= a.y + a.height - 2, `${first}/${second} stack at phone width`);
  }
  assert.equal((await head()).markup, beforePhone);
  console.log('  ok flow and positioned Grid stack on phones without a source edit');
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
      assert.equal(
        (
          await api('/edits', {
            method: 'POST',
            body: JSON.stringify({
              edit_id: remote.edit_id,
              old_string: 'Remote marker',
              new_string: 'Remote changed',
            }),
          })
        ).status,
        200,
      );
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
  assert.equal(
    await page.locator('#remote').textContent(),
    'Remote marker',
    'accepted remote source waits for composition',
  );
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
  assert.equal(await page.locator('.ProseMirror').count(), 0);
  assert.deepEqual(errors, []);
  console.log('  ok saved document reloads read-only without browser errors');
  const extended =
    '<div className="p-10"><Grid mode="flow" id="three"><GridItem id="c1" w={4}><p id="a1">one</p></GridItem><GridItem id="c2" w={4}><p id="a2">two</p></GridItem><GridItem id="c3" w={4}><p id="a3">three</p></GridItem></Grid><table><tbody><tr><td><p id="cell1">first cell</p></td><td><p id="cell2">second cell</p></td></tr></tbody></table>' +
    Array.from(
      { length: 300 },
      (_, i) => `<p id="long${i}">Paragraph ${i}: ${'bounded performance fixture '.repeat(8)}</p>`,
    ).join('') +
    '</div>';
  assert.equal((await api('', { method: 'PUT', body: JSON.stringify({ markup: extended }) })).status, 200);
  await page.goto('about:blank');
  const entered = Date.now();
  await page.goto(`${base}/a/${st.id}#edit`, { waitUntil: 'load' });
  await page.getByRole('textbox', { name: 'Document text' }).first().waitFor();
  console.log(`  evidence 300-paragraph editor ready in ${Date.now() - entered}ms including navigation`);
  assert.ok((await head()).markup.includes('id="a3"'), 'fixture has three columns');
  await range('a3', 4, 'a1', 1);
  await page.locator('[data-mx-block-status]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-mx-block-selected]').count(), 3);
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
  assert.equal(await page.locator('#cell1').textContent(), 'first cell');
  assert.equal(await page.locator('#cell2').textContent(), 'second cell');
  await page.getByRole('alert').filter({ hasText: 'Edit one table cell at a time' }).waitFor();
  await range('long150', 12);
  const began = Date.now();
  await page.keyboard.type('X');
  await page.waitForFunction(() => document.getElementById('long150').textContent.includes('X'));
  const latency = Date.now() - began;
  assert.ok(latency < 2000, `large-document input stalled for ${latency}ms`);
  console.log(`  evidence 300-paragraph input visible in ${latency}ms`);
  await stored((s) => /id="long150"[^>]*>[^<]*X/.test(s), 'large document edit persists');
  await page.getByRole('button', { name: 'Exit edit mode' }).click();
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
