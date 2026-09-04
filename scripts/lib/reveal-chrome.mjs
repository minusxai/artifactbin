/**
 * REVEALING THE READER'S CHROME, for gates that click one of its controls.
 *
 * A served document now opens with NOTHING but the artifact: the chrome is
 * rendered hidden and a scroll UP is what brings it back
 * (lib/story-runtime/reader-chrome-policy). Every gate that clicks `Open
 * artifact controls`, `Open menu` or a rail action on a TOP-LEVEL document has
 * to make that gesture first — a click on a `visibility: hidden` button is a
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
  const present = await target.evaluate(() => !!document.querySelector('[data-mx-reader-chrome]')).catch(() => false);
  if (!present) return false;
  /*
   * WAIT FOR THE WIRING, not for the markup. The chrome is server-rendered and
   * present at parse time; the module that answers a scroll is a separate
   * ~8 KB request, and a gesture made before it lands is a gesture nobody
   * heard. Its own side effect is the probe: the server renders the appearance
   * choices with no `aria-pressed`, and the entry stamps them.
   */
  await target.waitForFunction(() => !!document.querySelector('[data-mx-mode-choice][aria-pressed]'), null, { timeout: 30_000 })
    .catch(() => {});
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const shown = await target.evaluate(() =>
      document.querySelector('[data-mx-reader-chrome]')?.classList.contains('mx-reader-chrome--hidden') === false,
    ).catch(() => false);
    if (shown) return true;
    /*
     * TWO SAMPLES, SEPARATED IN TIME. The policy batches through one animation
     * frame, so scrolling down and back inside a single frame is one NET move
     * of 40px downward and the chrome stays hidden — which is the product
     * working, and cost this helper its first version.
     */
    await target.evaluate(() => window.scrollBy(0, 160));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await target.evaluate(() => window.scrollBy(0, -120));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return target.evaluate(() =>
    document.querySelector('[data-mx-reader-chrome]')?.classList.contains('mx-reader-chrome--hidden') === false,
  ).catch(() => false);
}
