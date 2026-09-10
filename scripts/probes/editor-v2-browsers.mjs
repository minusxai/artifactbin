/** Optional local cross-engine probe. Install Playwright Firefox/WebKit, then pass a disposable app URL. */
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';
import { startDocument, becomeOwner } from '../lib/start-doc.mjs';
const base = process.argv[2];
if (!base) throw Error('Pass a disposable running app URL');
for (const [name, engine, mobile] of [
  ['Firefox', firefox, false],
  ['WebKit', webkit, false],
  ['Chromium touch', chromium, true],
]) {
  const st = await startDocument(base);
  const api = (init = {}) =>
    fetch(`${base}/api/artifacts/${st.id}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
    });
  const source =
    '<div className="p-10"><p id="first">alpha paragraph</p><p id="second">bravo paragraph</p><Grid mode="flow"><GridItem id="left" w={6}><p>Left column</p></GridItem><GridItem id="right" w={6}><p>Right column</p></GridItem></Grid></div>';
  assert.equal((await api({ method: 'PUT', body: JSON.stringify({ markup: source }) })).status, 200);
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      hasTouch: mobile,
      ...(mobile ? { isMobile: true } : {}),
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await becomeOwner(page, base, st.token);
    await page.goto(`${base}/a/${st.id}#edit`);
    await page.getByRole('textbox', { name: 'Document text' }).first().waitFor({ timeout: 30000 });
    await page.evaluate(() => {
      const a = document.getElementById('first'),
        b = document.getElementById('second');
      a.closest('.ProseMirror').focus();
      getSelection().setBaseAndExtent(a.firstChild, 2, b.firstChild, 3);
    });
    await page.keyboard.type('X');
    await page.waitForFunction(() => document.getElementById('first')?.textContent === 'alXvo paragraph');
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+z`);
    await page.waitForFunction(() => document.getElementById('second')?.textContent === 'bravo paragraph');
    assert.equal(await page.locator('#first').textContent(), 'alpha paragraph');
    const endpoints = await page.evaluate(() => {
      const point = (el, offset) => {
        const r = document.createRange();
        r.setStart(el.firstChild, offset);
        r.setEnd(el.firstChild, offset + 1);
        const box = r.getBoundingClientRect();
        return { x: box.x, y: box.y + box.height / 2 };
      };
      return {
        start: point(document.getElementById('second'), 2),
        end: point(document.querySelector('#left p'), 5),
      };
    });
    await page.mouse.move(endpoints.start.x, endpoints.start.y);
    await page.mouse.down();
    await page.mouse.move(endpoints.end.x, endpoints.end.y, { steps: 12 });
    await page.mouse.up();
    await page
      .waitForFunction(() => getSelection().toString().includes('Left'), undefined, { timeout: 5000 })
      .catch(async (error) => {
        console.error(name, {
          errors,
          selection: await page.evaluate(() => ({
            text: getSelection().toString(),
            anchor: getSelection().anchorNode?.textContent,
            focus: getSelection().focusNode?.textContent,
            selected: [...document.querySelectorAll('[data-mx-block-selected]')].map((el) => el.textContent),
            editable: [...document.querySelectorAll('.ProseMirror')].map((el) => el.contentEditable),
          })),
        });
        throw error;
      });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.ProseMirror')].every((el) => el.contentEditable === 'true'),
    );
    if (mobile) {
      const a = await page.locator('#left').boundingBox(),
        b = await page.locator('#right').boundingBox();
      assert.ok(b.y >= a.y + a.height - 2);
      await page.locator('#first').tap();
      const control = page.getByRole('button', { name: 'Delete selected block', exact: true });
      const bounds = await control.boundingBox();
      assert.ok(bounds.width >= 44 && bounds.height >= 44);
      await control.tap();
      await page.waitForFunction(() => !document.getElementById('first'));
      await page.getByRole('button', { name: 'Undo', exact: true }).tap();
      await page.waitForFunction(() => !!document.getElementById('first'));
    }
    await page.getByRole('button', { name: 'Exit edit mode' }).click();
    await page.waitForFunction(() => !document.querySelector('.ProseMirror'));
    const stored = await (await api()).json();
    assert.ok(stored.markup.includes('alpha paragraph') && stored.markup.includes('bravo paragraph'));
    assert.deepEqual(errors, []);
    console.log(
      `${name}: cross-paragraph replace, native cross-region highlight, Undo, save${mobile ? ', phone stacking and touch delete/Undo' : ''} passed`,
    );
  } finally {
    await browser.close();
  }
}
