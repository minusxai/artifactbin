import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
/**
 * THE EDITOR ENGINE, end to end — the one editor there is.
 *
 * `services/app/lib/editor-engine` is the live engine: InPlaceEditor and the story
 * runtime's edit session import it, so what this gate drives in a real browser
 * is what a reader gets when they press Edit. Sections 1-3 are the engine's own
 * acceptance (native input, block structure, reversible layout, composition,
 * concurrency). The human PATH around it (entering, the source pane, version
 * history, a stranger who cannot save, the compiled page's handover) is gate-editor-path.mjs, and every
 * WAY OUT (and the editor's chrome on a phone) is gate-editor-exits.mjs: split so no gate shard waits on
 * one long script.
 *
 * The document is framed by the app page on its own origin: the text, its selection and the block chrome
 * (handles, drag preview, drop marker, block status) live INSIDE the frame; the toolbar, the insert menu, the
 * grid-cell control and the alerts are the page's.
 *
 *   usage: node scripts/gates/gate-editor-engine.mjs [base]
 */
import { launchChromium } from './lib/browser.mjs';
import { DOCUMENT_FRAME, documentFrame, documentLocator } from './lib/page-facts.mjs';
import { createChecker } from './lib/assert.mjs';
import { becomeOwner, startDocument } from '../lib/start-doc.mjs';

const check = createChecker('editor-engine');
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
const browser = await launchChromium();
const context = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
/** The framed document: locators re-resolve across reloads, evaluation runs in the document's own realm. */
const doc = () => documentLocator(page);
const inDoc = async (fn, arg) => (await documentFrame(page)).evaluate(fn, arg);
const waitInDoc = async (fn, arg, options) => (await documentFrame(page)).waitForFunction(fn, arg, options);
/*
 * The app is served on http://app.lvh.me, which is not a secure context, so it has no navigator.clipboard.
 * The clipboard is the browser's, not the page's: a helper tab on a secure origin (loopback) fills it, and
 * the real Mod-V keystroke pastes it into the frame.
 */
const clipboardPage = await context.newPage();
await clipboardPage.route('http://localhost/clipboard', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>clipboard</title>' }));
await clipboardPage.goto('http://localhost/clipboard');
async function setClipboard(fill) {
  await clipboardPage.bringToFront();
  await clipboardPage.evaluate(fill);
  await page.bringToFront();
}
await becomeOwner(page, base, st.token);
await page.goto(`${base}/a/${st.id}#edit`, { waitUntil: 'load' });
await doc().getByRole('textbox', { name: 'Document text' }).first().waitFor({ timeout: 30000 });
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
  await inDoc(async (id) => {
    const node = document.getElementById(id);
    if (!node) throw Error(`Missing editor range node: ${id}`);
    node.scrollIntoView({ block: 'nearest' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, startId);
  await inDoc(
    ({ startId, start, endId, end }) => {
      const a = document.getElementById(startId),
        b = document.getElementById(endId);
      if (!a || !b) throw Error(`Missing editor range node: ${startId} or ${endId}`);
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
/** Typing shows no block handles: Esc selects the caret's block. */
async function selectBlock(id) {
  await range(id, 2);
  await page.keyboard.press('Escape');
  await doc().locator('[data-mx-node-chrome]').waitFor({ state: 'visible' });
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
  const originalClass = await doc().locator('#first').getAttribute('class');
  await page.getByRole('button', { name: 'Increase font size', exact: true }).click();
  await stored((s) => /id="first"[^>]*text-/.test(s), 'block formatting after replacement');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitInDoc((cls) => document.getElementById('first')?.getAttribute('class') === cls, originalClass);
  await stored((s) => s.includes('alXvo second paragraph') && !/id="first"[^>]*text-/.test(s), 'button Undo removes only formatting');
  await undo(
    (s) => s.includes('alpha first paragraph') && s.includes('bravo second paragraph'),
    'Undo restores both paragraph identities',
  );
  const restoredSelection = await inDoc(() => {
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
  await setClipboard(async () =>
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
  await range('first', 0, 'first', 5);
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
  await page.getByRole('button', { name: 'Insert Markdown', exact: true }).click();
  await stored((s) => /<Markdown id="[A-Za-z][A-Za-z0-9]{3}">\{``\}<\/Markdown>/.test(s), 'Insert Markdown creates an empty component');
  await waitInDoc(() => document.activeElement?.matches('[data-mx-lexical]'));
  await page.keyboard.type('New Markdown region');
  await stored((s) => s.includes('New Markdown region'), 'the inserted Markdown component is immediately editable');
  await undo((s) => s.includes('<Markdown') && !s.includes('New Markdown region'), 'Markdown typing undoes');
  await undo((s) => !s.includes('<Markdown') && s.includes('alpha first paragraph'), 'Markdown component insertion undoes');
  await setClipboard(() => navigator.clipboard.writeText('**literal**'));
  await range('code', 4);
  await page.keyboard.press(`${mod}+v`);
  await stored((s) => s.includes('**literal**') && !s.includes('<strong'), 'code paste stays literal');
  await undo((s) => !s.includes('**literal**'), 'code paste undo');
  await range('first', 2);
  check(await doc().locator('[data-mx-node-chrome]').isVisible() === false, 'a caret in text shows no block handles');
  await page.keyboard.press('Escape');
  await doc().locator('[data-mx-node-chrome]').waitFor({ state: 'visible' });
  const blockedControls = await doc().locator('[data-mx-node-chrome]').evaluate((root) =>
    [...root.querySelectorAll('button')].flatMap((button) => {
      const rect = button.getBoundingClientRect();
      if (!rect.width || !rect.height) return [];
      const hit = button.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit && button.contains(hit) ? [] : [button.getAttribute('aria-label')];
    }),
  );
  must(blockedControls.length === 0, `every selection control receives clicks at its visible center (${blockedControls.join(', ') || 'none blocked'})`);
  await doc().getByRole('button', { name: 'Delete selected block', exact: true }).click();
  await stored((s) => !s.includes('id="first"'), 'selected trash control deletes exactly its source block');
  await undo((s) => s.includes('id="first"'), 'node deletion restores its identity');
  await selectBlock('first');
  const handle = doc().getByRole('button', { name: 'Resize block height', exact: true });
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await stored((s) => /id="first"[^>]*min-h-\[/.test(s), 'keyboard resize commits one explicit minimum height');
  await undo((s) => !/id="first"[^>]*min-h-\[/.test(s), 'resize undo');
  // A pointer preview is cancellable and never persists until release.
  await selectBlock('first');
  const pointerHandle = doc().getByRole('button', { name: 'Resize block height', exact: true });
  const bounds = await pointerHandle.boundingBox();
  const beforeCancel = (await head()).markup;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 70, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  check((await head()).markup === beforeCancel, 'a cancelled pointer resize writes nothing at all');
  await selectBlock('first');
  const corner=await doc().getByRole('button',{name:'Resize selected block',exact:true}).boundingBox();
  const beforeResize=await head();
  await page.mouse.move(corner.x+corner.width/2,corner.y+corner.height/2);await page.mouse.down();
  await page.mouse.move(corner.x+corner.width/2+80,corner.y+corner.height/2+60,{steps:6});
  check((await head()).markup === beforeResize.markup, 'pointer preview does not save intermediate dimensions');
  await waitInDoc(() => Math.abs(document.getElementById('first').getBoundingClientRect().width-680)<2, undefined, {timeout:3000});

  check(Math.abs((await doc().locator('#first').boundingBox()).width - 680) < 2, 'content reflows during the resize preview');
  await page.mouse.up();
  const resized=await stored(s=>/id="first"[^>]*w-\[680px\]/.test(s)&&/id="first"[^>]*min-h-\[/.test(s),'pointer drag changes width and height');
  check(resized.version === beforeResize.version + 1, 'one resize gesture creates one saved version');
  await undo(s=>/id="first"[^>]*w-\[600px\]/.test(s)&&!/id="first"[^>]*min-h-\[/.test(s),'pointer resize undoes both dimensions together');
  await selectBlock('first');
  const move = doc().getByRole('button', { name: 'Move selected block', exact: true });
  const grip = await move.boundingBox(), destination = await doc().locator('#second').boundingBox();
  const beforeMove = await head();
  const own = await doc().locator('#first').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(own.x + own.width / 2, own.y + own.height / 2, {steps:4});
  await doc().locator('[data-mx-drag-preview][data-mx-drop-state="none"]').waitFor({state:'visible'});
  check(await doc().locator('[data-mx-drag-preview]').textContent() === '⠿ Paragraph', 'the drag label names the block, neutral over itself');
  check(await doc().locator('[data-mx-drop-marker]').isVisible() === false, 'and offers no insertion marker there');
  // The document's own top-left corner, outside the block's parent (the frame sits below the app bar).
  const frameBox = await page.locator(DOCUMENT_FRAME).boundingBox();
  await page.mouse.move(frameBox.x + 5, frameBox.y + 5, {steps:4});
  await doc().locator('[data-mx-drag-preview][data-mx-drop-state="valid"]').waitFor({state:'visible'});
  check(await doc().locator('[data-mx-drop-marker]').isVisible(), 'outside the parent the marker snaps to the nearest slot');
  await page.mouse.move(own.x + own.width / 2, own.y + own.height / 2, {steps:4});
  await doc().locator('[data-mx-drag-preview][data-mx-drop-state="none"]').waitFor({state:'visible'});
  await page.mouse.up();
  check((await head()).markup === beforeMove.markup, 'releasing over the block itself does not edit source');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x + 20, destination.y + destination.height / 2, {steps:6});
  await doc().locator('[data-mx-drag-preview][data-mx-drop-state="valid"]').waitFor({state:'visible'});
  check(await doc().locator('[data-mx-drag-preview]').textContent() === '⠿ Paragraph', 'valid drag feedback stays a neutral label');
  await doc().locator('[data-mx-drop-marker]').waitFor({state:'visible'});
  check((await head()).markup === beforeMove.markup, 'drag feedback does not edit source');
  await page.mouse.up();
  await stored(s=>s.indexOf('id="second"')<s.indexOf('id="first"'), 'pointer drop follows the visible insertion marker');
  check(await doc().locator('[data-mx-drag-preview]').isVisible() === false, 'and the preview disappears on release');
  await undo(s=>s.indexOf('id="first"')<s.indexOf('id="second"'), 'pointer move undoes in one step');
  await selectBlock('first');
  await move.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await stored(
    (s) => s.indexOf('id="second"') < s.indexOf('id="first"'),
    'dedicated grip moves a block without changing identity',
  );
  await undo((s) => s.indexOf('id="first"') < s.indexOf('id="second"'), 'move undo restores source order');
  await range('second', 4, 'lp', 5);
  await waitInDoc(() => getSelection().toString().includes('Left '));
  check(await doc().locator('[data-mx-node-chrome]').isVisible() === false, 'text selection has no container resize controls');
  const unhoveredOutline = await doc().locator('#second').evaluate(el => getComputedStyle(el).outline);
  await doc().locator('#second').hover();
  check(await doc().locator('#second').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgba(0, 0, 0, 0)', 'hovered text is not tinted');
  check(await doc().locator('#second').evaluate(el => getComputedStyle(el).outline) === unhoveredOutline, 'hovering text adds no outline');
  await page.mouse.move(0, 0);
  check(await doc().locator('#second').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgba(0, 0, 0, 0)',
    'block selection does not flood the text background');
  await page.keyboard.press('Escape');
  await selectBlock('first');
  const narrowHandle = await doc().getByRole('button', {name:'Resize block width',exact:true}).boundingBox();
  await page.mouse.move(narrowHandle.x+narrowHandle.width/2,narrowHandle.y+narrowHandle.height/2);
  await page.mouse.down();
  await page.mouse.move(narrowHandle.x+narrowHandle.width/2-180,narrowHandle.y+narrowHandle.height/2,{steps:8});
  await waitInDoc(() => Math.abs(document.getElementById('first').getBoundingClientRect().width-420)<2, undefined, {timeout:3000});
  check(Math.abs((await doc().locator('#first').boundingBox()).width - 420) < 2, 'shrinking reflows text before release');
  await inDoc(() => window.scrollBy(0,20));
  check(Math.abs((await doc().locator('#first').boundingBox()).width - 420) < 2, 'scroll does not reset the active preview');
  await page.mouse.up();
  await stored(s=>/id="first"[^>]*w-\[420px\]/.test(s),'shrinking saves the previewed width');
  await undo(s=>/id="first"[^>]*w-\[600px\]/.test(s),'shrinking remains one undo action');
  await range('lp', 2);
  await page.getByRole('button', { name: 'Select Grid cell', exact: true }).click();
  const divider = doc().getByRole('button', { name: 'Resize adjacent columns', exact: true });
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
  await doc().locator('[data-mx-block-status]').waitFor({ state: 'visible' });
  await page.keyboard.type('MUST_NOT_INSERT');
  check(await doc().locator('#lp').textContent() === 'Left column text', 'typing across two columns inserts nothing into either');
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
    const a = await doc().locator(`#${first}`).boundingBox(),
      b = await doc().locator(`#${second}`).boundingBox();
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
  check(await doc().locator('#remote').textContent() === 'Remote marker', 'accepted remote source waits for composition');
  await cdp.send('Input.insertText', { text: '日本語' });
  await stored(
    (s) => s.includes('日本語') && s.includes('Remote changed'),
    'composition and concurrent accepted source both persist',
  );
  await doc().getByText('Remote changed', { exact: true }).waitFor();
  await undo((s) => !s.includes('日本語') && s.includes('Remote changed'), 'Undo preserves an unrelated remote edit');
  await page.getByRole('button', { name: 'Exit edit mode' }).click();
  await page.reload();
  await doc().getByText('Remote changed', { exact: true }).waitFor();
  check(await doc().locator('.ProseMirror').count() === 0, 'a saved document reloads READ-ONLY');
  check(errors.length === 0, `and the browser reported no error on the way (${errors.slice(0, 2).join('; ') || 'none'})`);
  must((await api('', { method: 'PUT', body: JSON.stringify({ markup: '<article><p id="literal">HTML text</p><p id="task"><input type="checkbox" aria-label="Task completed" disabled checked={false} /> Task</p><pre id="fence">Code</pre><blockquote><p id="quote">Quote</p></blockquote></article>' }) })).status === 200, 'the HTML editing fixture publishes');
  await page.goto('about:blank');
  await page.goto(`${base}/a/${st.id}#edit`, { waitUntil: 'load' });
  await doc().getByRole('textbox', { name: 'Document text' }).first().waitFor();
  await range('literal', 0);
  await page.keyboard.type('# **literal** - [guide](example.com) ');
  await stored(s => s.includes('<p id="literal"># **literal** - [guide](example.com) HTML text</p>'), 'HTML Markdown typing stays literal');
  await doc().getByRole('checkbox', { name: 'Task completed' }).check();
  await stored(s => /\bchecked\s*\/>/.test(s), 'checkbox toggles save their checked state');
  await range('fence', 0);
  await page.keyboard.type('# literal');
  await page.keyboard.press('Enter');
  await page.keyboard.type('  code');
  await stored(s => /<pre id="fence"># literal\n  codeCode<\/pre>/.test(s), 'fenced code keeps literal markers and indented newlines');
  await page.getByRole('button', { name: 'Exit edit mode' }).click();
  await page.reload();
  const savedTask = doc().getByRole('checkbox', { name: 'Task completed' });
  await savedTask.waitFor();
  check(await savedTask.isChecked() && await savedTask.isDisabled(), 'reader reload displays saved checkboxes read-only');
  await page.goto(`${base}/a/${st.id}#edit`, { waitUntil: 'load' });
  await doc().getByRole('textbox', { name: 'Document text' }).first().waitFor();
  await doc().getByRole('checkbox', { name: 'Task completed' }).uncheck();
  await stored(s => /checked=\{false\}/.test(s), 'reopened checklist remains editable');
  await page.getByRole('button', { name: 'Exit edit mode' }).click();
  const markdownFeatures = '- [ ] Open task\n- [ ] Next task\n\n---\n\n| Name | Value |\n| --- | --- |\n| Total | 42 |\n\n~~~~ts\nconst answer: number = 42;\n~~~~\n\nAfter table.';
  must((await api('', { method: 'PUT', body: JSON.stringify({ markup: `<article><Markdown id="features">{${JSON.stringify(markdownFeatures)}}</Markdown></article>` }) })).status === 200, 'the Markdown features fixture publishes');
  await page.goto('about:blank');
  await page.goto(`${base}/a/${st.id}#edit`, { waitUntil: 'load' });
  await doc().getByRole('textbox', { name: 'Markdown text' }).waitFor();
  const task = doc().getByRole('checkbox', { name: 'Open task', exact: true });
  check(await task.evaluate(el => parseFloat(getComputedStyle(el, '::before').width) > 0), 'the Markdown checkbox has a visible hit target');
  await task.click({ position: { x: 8, y: 12 } });
  await stored(s => s.includes('[x] Open task'), 'Markdown checklist toggles persist');
  await doc().getByText('Next task', { exact: true }).click();
  await page.keyboard.press('End');
  // The checkbox click focuses its item. Wait for the native caret and Lexical's
  // selectionchange turn to reach the next label before sending its Tab command.
  await waitInDoc(() => getSelection()?.anchorNode?.parentElement?.closest('li')?.textContent === 'Next task');
  await inDoc(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press('Tab');
  await waitInDoc(() => document.querySelector('#features li li')?.textContent === 'Next task');
  await stored(s => /\n +[-*] \[ \] Next task/.test(s), 'Tab persists nested Markdown checklist items');
  await page.keyboard.press('Shift+Tab');
  await waitInDoc(() => !document.querySelector('#features li li'));
  await doc().getByRole('cell', { name: '42', exact: true }).getByText('42', { exact: true }).dblclick();
  await waitInDoc(() => getSelection()?.toString() === '42');
  await inDoc(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.type('43');
  await stored(s => s.includes('| Total | 43 |'), 'Markdown table cell edits persist');
  await page.getByRole('button', { name: 'Add row below', exact: true }).click();
  await waitInDoc(() => document.querySelectorAll('#features tr').length === 3);
  await page.getByRole('button', { name: 'Add column right', exact: true }).click();
  await waitInDoc(() => document.querySelectorAll('#features th').length === 3);
  await page.getByRole('button', { name: 'Exit edit mode' }).click();
  await page.reload();
  await doc().getByRole('cell', { name: '43', exact: true }).waitFor();
  check(await doc().getByRole('checkbox', { name: 'Open task', exact: true }).getAttribute('aria-checked') === 'true', 'saved Markdown checklist state reopens');
  check(await doc().locator('#features hr').count() === 1 && await doc().locator('#features tr').count() === 3 && await doc().locator('#features th').count() === 3, 'saved Markdown divider and table dimensions reopen');
  const highlightedCode = doc().locator('#features code.language-typescript');
  check(await highlightedCode.textContent() === 'const answer: number = 42;'
    && (await highlightedCode.locator('.mx-code-token-keyword').allTextContents()).includes('const'),
    'the compiled reader preserves tilde-fenced language, syntax tokens and exact code after saved Markdown edits');
  check(await highlightedCode.locator('.mx-code-token-keyword').first().evaluate(el => getComputedStyle(el).color)
    !== await highlightedCode.evaluate(el => getComputedStyle(el).color),
    'compiled reader syntax tokens receive their highlighting colors');
  check(!(await head()).markup.includes('mx-code-token'),
    'derived highlighting spans never enter saved Markdown source');
  await page.goto(`${base}/a/${st.id}#edit`, { waitUntil: 'load' });
  await doc().getByRole('textbox', { name: 'Markdown text' }).waitFor();
  await doc().getByText('After table.', { exact: true }).click();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Markdown block style', exact: true }).click();
  await page.getByRole('option', { name: 'Table', exact: true }).click();
  await waitInDoc(() => document.activeElement?.matches('[data-mx-lexical]') && getSelection()?.anchorNode?.parentElement?.closest('th'));
  await page.keyboard.type('New header');
  await stored(s => s.includes('| New header |'), 'table insertion returns focus to the first cell for immediate typing');
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
  await doc().getByRole('textbox', { name: 'Document text' }).first().waitFor();
  check.note(`300-paragraph editor ready in ${Date.now() - entered}ms including navigation`);
  must((await head()).markup.includes('id="a3"'), 'the three-column fixture is what the editor opened');
  await range('a3', 4, 'a1', 1);
  await doc().locator('[data-mx-block-status]').waitFor({ state: 'visible' });
  check(await doc().locator('[data-mx-block-selected]').count() === 3, 'a backward selection across three columns selects three blocks');
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
  check(await doc().locator('#cell1').textContent() === 'first cell'
    && await doc().locator('#cell2').textContent() === 'second cell',
  'typing across two table cells writes into neither');
  await page.getByRole('alert').filter({ hasText: 'Edit one table cell at a time' }).waitFor();
  await range('long150', 12);
  const began = Date.now();
  await page.keyboard.type('X');
  await waitInDoc(() => document.getElementById('long150').textContent.includes('X'));
  const latency = Date.now() - began;
  check(latency < 2000, `input stays responsive in a 300-paragraph document (${latency}ms to paint)`);
  await stored((s) => /id="long150"[^>]*>[^<]*X/.test(s), 'large document edit persists');
  await page.getByRole('button', { name: 'Exit edit mode' }).click();
  check(errors.length === 0, `the whole pass reported no browser error (${errors.slice(0, 2).join('; ') || 'none'})`);
} finally {
  await browser.close();
}
check.done();
