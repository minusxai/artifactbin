/**
 * REVEALING THE READER'S CHROME, for gates that click one of its controls.
 *
 * A served document opens with visible chrome; scrolling down hides it and
 * a scroll UP brings it back
 * (lib/story-runtime/reader-chrome-policy). Every gate that clicks `Open
 * artifact controls`, `Open menu` or a rail action on a TOP-LEVEL document has
 * to ensure it is revealed — a click on a `visibility: hidden` button is a
 * click Playwright rightly refuses.
 *
 * The gesture, not a class flip: down 160, a beat, then up 120, so the policy
 * answers the way it would for a thumb. The beat is load-bearing — the policy
 * batches through one animation frame, so both scrolls in one breath are one
 * net move DOWNWARD and the chrome stays away. A document that cannot scroll
 * shows the chrome already and this returns at once.
 *
 * The OWNER's shell is untouched by any of this — its dock is the page's, not
 * the document's — so a gate driving an owner/editor/commenter page needs
 * nothing from here.
 */

/**
 * Bring the reader chrome on screen in `target` (a Playwright Page or Frame)
 * and resolve once it is there. Resolves immediately when there is no chrome
 * (a framed document hides its own; the parent supplies the visible one).
 */
export async function revealReaderChrome(target) {
  const chrome = target.locator('[data-mx-reader-chrome]').first();
  const present = await chrome.count();
  if (!present) return false;
  /*
   * WAIT FOR THE WIRING, not for the markup. The chrome is server-rendered and
   * present at parse time; the module that answers a scroll is a separate
   * ~8 KB request, and a gesture made before it lands is a gesture nobody
   * heard. Its own side effect is the probe: the server renders the appearance
   * choices with no `aria-pressed`, and the entry stamps them.
   */
  await chrome.waitFor({ state: 'attached', timeout: 30_000 });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const shown = await chrome.evaluate(element =>
      element.classList.contains('mx-reader-chrome--hidden') === false,
    ).catch(() => false);
    // The initial server markup is visible before hydration/history scroll
    // restoration finishes. Always make one real reveal gesture before
    // accepting that state; otherwise the helper can return just before a
    // queued downward scroll hides the controls it promised to reveal.
    if (shown && attempt > 0) return true;
    /*
     * TWO SAMPLES, SEPARATED IN TIME. The policy batches through one animation
     * frame, so scrolling down and back inside a single frame is one NET move
     * of 40px downward and the chrome stays hidden — which is the product
     * working, and cost this helper its first version.
     */
    // Down, then back up by the SAME amount: the reveal is the direction, and
    // the reader's place must be exactly where it was (gate-inplace-edit
    // measures scrollY across it).
    await target.evaluate(() => window.scrollBy(0, 160));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await target.evaluate(() => window.scrollBy(0, -160));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return chrome.evaluate(element =>
    element.classList.contains('mx-reader-chrome--hidden') === false,
  ).catch(() => false);
}

/**
 * WHERE THE CHROME LIVES for a page, now that the app pages carry a bar, a
 * shared document carries its own chrome, and an owner's page frames a document
 * that carries the same chrome and ASKS the page to open the panels:
 *   - 'page'     — a frameless page (a dataset, an image, the home page): the
 *                  bar's own button opens the panel;
 *   - 'document' — a document served top-level: its chrome opens its own panel;
 *   - 'frame'    — a framed document: its chrome asks, the page's panel opens.
 */
async function chromeHost(page, timeout = 30_000) {
  // Whichever shape this page takes arrives after navigation, not with it:
  // wait for the first sign of any of them.
  await page.waitForSelector(
    '[data-mx-reader-chrome], [aria-label="Open artifact controls"], [aria-label="Open page controls"], [aria-label="Open menu"]',
    { state: 'attached', timeout },
  ).catch(() => {});
  // A lazy route's provisional page bar is not the destination's controls.
  // Wait for the actual handoff before deciding whether to reveal reader
  // chrome or click page chrome; otherwise a click can target a disappearing
  // skeleton (or classify hidden reader controls as ordinary page controls).
  await page.locator('[data-mx-page-pending]').waitFor({ state: 'detached', timeout });
  // A document served top-level IS the page, and its chrome carries "Open menu"
  // too — so this is asked before the page-button question, or a hidden
  // trigger gets clicked as if it were a bar button.
  if (await page.locator('[data-mx-reader-chrome]').count()) return { kind: 'document', target: page };
  return { kind: 'page', target: page };
}

/** Open the artifact (or page) controls panel, wherever the control is. */
export async function openArtifactControls(page, { timeout = 30_000 } = {}) {
  const host = await chromeHost(page, timeout);
  if (host.kind === 'page') {
    await page.locator('[aria-label="Open artifact controls"], [aria-label="Open page controls"]').first().click({ timeout });
    return;
  }
  await revealReaderChrome(host.target);
  await host.target.locator('[data-mx-reader-trigger="controls"]').click({ timeout });
  await page.waitForSelector('[aria-label="Artifact controls"], [aria-label="Page controls"]', { timeout });
  await refocusPage(page, '[aria-label="Artifact controls"], [aria-label="Page controls"]');
}

/*
 * A click inside the frame leaves the keyboard focus THERE, so a gate's next
 * `keyboard.press('Escape')` would reach the document and never the page's
 * panel. Hand focus to the panel the page just opened.
 */
async function refocusPage(page, panelSelector) {
  await page.locator(panelSelector).first().evaluate((panel) => {
    // Blur the frame first: that alone returns keyboard focus to the page.
    // Then prefer a focusable that is actually rendered — the panel's first
    // control may be a phone-only button that display:none makes unfocusable.
    const active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === 'function') active.blur();
    const candidates = panel ? Array.from(panel.querySelectorAll('button, a, input, [tabindex]')) : [];
    const visible = candidates.find((el) => el.getClientRects().length > 0);
    if (visible) visible.focus();
  }).catch(() => {});
}

/** Open the menu (account / navigation) panel, wherever the control is. */
export async function openMenu(page, { timeout = 30_000 } = {}) {
  const host = await chromeHost(page, timeout);
  if (host.kind === 'page') {
    await page.locator('[aria-label="Open menu"]').first().click({ timeout });
    return;
  }
  await revealReaderChrome(host.target);
  await host.target.locator('[data-mx-reader-trigger="menu"]').click({ timeout });
  await page.waitForSelector('nav[aria-label="Menu"]', { timeout });
  await refocusPage(page, 'nav[aria-label="Menu"]');
}
