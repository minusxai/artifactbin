import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
/**
 * THE HUMAN PATH AROUND THE EDITOR — split out of gate-editor-v2.mjs (its section 4) so no gate
 * shard waits on one two-minute script. gate-editor-v2 drives the engine; this drives the way in.
 *
 *   usage: node scripts/gate-editor-path.mjs [base]
 */
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { createChecker } from './lib/assert.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { becomeAccountOwner, becomeOwner, startDocument } from './lib/start-doc.mjs';
import { startMailSink, isSignedInAs } from './lib/mail-login.mjs';

const check = createChecker('editor-path');
/** A step whose failure invalidates every step after it: report it, then stop. */
const must = (condition, label) => { if (!check(condition, label)) throw new Error(label); };
const base = process.argv[2] ?? 'http://localhost:3030';
const browser = await chromium.launch();
const sink = await startMailSink();
try {
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
<Import name="sales_data" src="ref:${dataset.id}" /><Query name="sales">{\`select * from sales_data.rows where $region is null or region = $region\`}</Query>
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

    // Versions are the edit panel's History tab on a wide window — the panel
    // is up for the whole session, so what must hold is that the list clears
    // the toolbar and its current row is in view.
    {
      const panel = humanPage.getByRole('complementary', { name: 'Edit panel' });
      await panel.getByRole('tab', { name: 'History' }).click();
      const history = panel.getByRole('region', { name: 'Version history' });
      const toolbar = await humanPage.getByRole('banner', { name: 'Editor toolbar' }).boundingBox();
      const list = await history.boundingBox();
      check(!!toolbar && !!list && list.y >= toolbar.y + toolbar.height - 1, 'the version list clears the toolbar at 1400px');
      const current = await history.getByRole('button', { name: 'Show the current version' }).boundingBox();
      check(!!current && !!list && current.y >= list.y && current.y <= 950, 'the current version is in view at 1400px');
      check((await humanPage.getByRole('button', { name: 'Open version history' }).count()) === 0,
        'no drawer switch beside the panel at 1400px');
      await panel.getByRole('tab', { name: 'Selection' }).click();
    }
    // Below the panel breakpoint (960px) there is no side panel: the bar's
    // switch opens the versions as a bottom sheet, at a laptop-narrow width
    // and on a phone alike.
    for (const viewport of [{ width: 900, height: 700 }, { width: 390, height: 844 }]) {
      await humanPage.setViewportSize(viewport);
      // The panel leaves on the window's resize event, a render after the resize resolves.
      check(await humanPage.getByRole('complementary', { name: 'Edit panel' }).waitFor({ state: 'detached', timeout: 5000 })
        .then(() => true, () => false), `no side panel at ${viewport.width}px`);
      await humanPage.getByRole('button', { name: 'Open version history', exact: true }).click();
      const sheet = humanPage.getByRole('dialog', { name: 'Version history' });
      await sheet.waitFor({ state: 'visible' });
      // The sheet SLIDES in; its header is still moving when the checks reach for it.
      await humanPage.waitForTimeout(600);
      check(await sheet.getByRole('button', { name: 'Show the current version' }).isVisible(),
        `history keeps the current version visible in its bottom sheet at ${viewport.width}px`);
      await sheet.getByRole('button', { name: 'Close version history' }).click();
      check(await humanPage.getByRole('button', { name: 'Open version history' }).getAttribute('aria-expanded') === 'false',
        `history close button remains usable at ${viewport.width}px`);
      // Escape also works on a broken layout, so a failed geometry check cannot stall the gate.
      await humanPage.keyboard.press('Escape');
    }
    await humanPage.setViewportSize({ width: 1400, height: 950 });

    // Idle must not spend versions: nothing typed ⇒ nothing written.
    const quiet = (await (await humanApi()).json()).version;
    await humanPage.waitForTimeout(2000);
    check((await (await humanApi()).json()).version === quiet, 'an idle editor writes nothing');

    /*
     * THE SOURCE PANE. The previous editor's wrapper injected a <script>
     * pointing at jsdelivr, and the app's own CSP (`script-src 'self'`)
     * refused it — so `code` mode showed "Loading…" forever, in development
     * and on the deployment alike, and nothing in the unit suite could see it
     * (the editor's UI test stubs the editor). The real editor must mount here,
     * from this origin.
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
    check(true, 'the immediately editable fallback uses the editor’s dark palette');
    await plainSource.fill(initialSource.replace('Editor gate', 'Edited while rich editor loads'));
    releaseRichEditor();
    check(await humanPage.waitForSelector('.cm-editor [aria-label="Markup source"]', { timeout: 30_000 })
      .then(() => true, () => false), 'the source pane mounts a real editor, not a permanent "Loading…"');
    const editorPaint = await humanPage.locator('.cm-editor').evaluate((editor) => ({
      background: getComputedStyle(editor).backgroundColor,
      // CodeMirror's base theme lays the scroller out as flex; that it applies proves its
      // styles reached TrustedUi's shadow root, which the app's head stylesheet cannot.
      scrollerDisplay: getComputedStyle(editor.querySelector('.cm-scroller')).display,
      editable: editor.querySelector('.cm-content')?.getAttribute('contenteditable'),
      height: editor.getBoundingClientRect().height,
    }));
    check(editorPaint.scrollerDisplay === 'flex' && editorPaint.background === 'rgb(30, 30, 30)'
      && editorPaint.editable === 'true' && editorPaint.height > 200,
    'rich editor has shadow-local styles, opaque paint, an editable surface and usable height');
    check(await humanPage.locator('.cm-editor').evaluate((editor) => new Promise((resolve) => {
      // TrustedUi has its own focus scope: ask its root, not the document.
      if (editor.contains(editor.getRootNode().activeElement)) return resolve(true);
      const done = () => { clearTimeout(timer); editor.removeEventListener('focusin', done); resolve(true); };
      const timer = setTimeout(() => { editor.removeEventListener('focusin', done); resolve(false); }, 5000);
      editor.addEventListener('focusin', done);
    })), 'rich-editor handoff preserves keyboard focus');
    check((await humanPage.locator('[aria-label="Source pane"]').getByText('Loading...').count()) === 0,
      'and the loading placeholder is gone');
    /*
     * The pane is the document's own markup, not an empty buffer. A naive
     * substring check would lie: the editor renders only the LINES near the
     * screen. What holds regardless: it is showing this document, from the
     * top.
     */
    const flat = (t) => t.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const lines = await humanPage.locator('[aria-label="Source pane"] .cm-line').allTextContents();
    const storedSource = flat((await (await humanApi()).json()).markup);
    check(lines.length >= 3 && storedSource.startsWith(flat(lines[0])) && flat(lines[0]).length > 0,
      `the pane carries the document source (${lines.length} lines from ${JSON.stringify(flat(lines[0] ?? '').slice(0, 30))})`);
    check(offOrigin.length === 0, `the editor loads no off-origin script (${offOrigin.slice(0, 2).join(', ') || 'none'})`);
    check(cspErrors.length === 0, `and trips no CSP directive (${cspErrors.slice(0, 1).join(' ') || 'none'})`);

    /*
     * AND TYPING INTO IT MUST NOT LOSE CHARACTERS. A controlled <Editor value>
     * is a race: every keystroke sets React state, and a render one keystroke
     * behind pushes that STALE string back into the editor. Measured before
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
    const paneAfter = ((await humanPage.locator('[aria-label="Source pane"] .cm-content').textContent().catch(() => '')) ?? '')
      .replace(/ /g, ' ');
    check(paneAfter.includes('Agent wrote while code was open:'), 'and the open code pane still adopts an agent edit');

    // Formatting is a read-only projection, never a source edit or a model reset.
    const beforePreview = await (await humanApi()).json();
    await humanPage.locator('.cm-editor').evaluate((el) => { window.__originalSourceEditor = el; });
    await humanPage.getByRole('button', { name: 'View formatted', exact: true }).click();
    await humanPage.locator('.cm-editor [aria-label="Formatted JSX"]').waitFor();
    check(await humanPage.getByText('Formatted preview · read-only', { exact: true }).isVisible(),
      'formatted source is explicitly read-only');
    check(await humanPage.locator('.cm-editor:visible .cm-line').count() > 1, 'the preview shows formatted JSX');
    await humanPage.getByRole('button', { name: 'Edit source', exact: true }).click();
    check(await humanPage.locator('.cm-editor:visible').evaluate((el) => el === window.__originalSourceEditor),
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

} finally {
  await browser.close();
  sink.close();
}
check.done();
