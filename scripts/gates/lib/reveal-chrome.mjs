/**
 * THE APP'S BAR, for gates that click one of its controls.
 *
 * A document is served on its own origin and framed by the app page (lib/serving/document-frame); the bar around
 * it is the app's own (solid/document/DocumentChrome, solid/components/PageChrome), always on screen: "Open artifact
 * controls" (or "Open page controls" on an app page) and "Open menu" are ordinary buttons on the app page. Nothing in
 * a document carries the app's chrome any more, so there is nothing to reveal.
 */

/** Wait for the destination's own bar (a lazy route's provisional page bar is not it). */
async function settled(page, timeout) {
  await page.waitForSelector('[aria-label="Open artifact controls"], [aria-label="Open page controls"], [aria-label="Open menu"]', { state: 'attached', timeout }).catch(() => {});
  await page.locator('[data-mx-page-pending]').waitFor({ state: 'detached', timeout });
}

/** Open the artifact (or page) controls panel. */
export async function openArtifactControls(page, { timeout = 30_000 } = {}) {
  await settled(page, timeout);
  await page.locator('[aria-label="Open artifact controls"], [aria-label="Open page controls"]').first().click({ timeout });
  await page.waitForSelector('[aria-label="Artifact controls"], [aria-label="Page controls"]', { timeout });
  await refocusPage(page, '[aria-label="Artifact controls"], [aria-label="Page controls"]');
}

/*
 * A click inside the document's frame leaves the keyboard focus THERE, so a gate's next
 * `keyboard.press('Escape')` would reach the document and never the page's panel. Hand focus to the panel.
 */
async function refocusPage(page, panelSelector) {
  await page.locator(panelSelector).first().evaluate((panel) => {
    const active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === 'function') active.blur();
    const candidates = panel ? Array.from(panel.querySelectorAll('button, a, input, [tabindex]')) : [];
    const visible = candidates.find((el) => el.getClientRects().length > 0);
    if (visible) visible.focus();
  }).catch(() => {});
}

/** Open the menu (account / navigation) panel. */
export async function openMenu(page, { timeout = 30_000 } = {}) {
  await settled(page, timeout);
  await page.locator('[aria-label="Open menu"]').first().click({ timeout });
  await page.waitForSelector('nav[aria-label="Menu"]', { timeout });
  await refocusPage(page, 'nav[aria-label="Menu"]');
}
