/**
 * Internal: check.mjs's saved screenshot, serialized into the hosted script like the other PARTS:
 * it references only its own parameters.
 * Used by: toolbox-check-inspect.mjs (PARTS).
 */

/** The document's full height at the viewport's width, up to 8000 px. A deck, a page that fits
 * and one that cannot be captured whole keep the viewport; `partial` says why it is not whole. */
export async function capture(page, options, deck) {
  const {width, height: tall} = options.viewport;
  const frame = page.mainFrame().locator('iframe[data-mx-document-frame]');
  const hosted = options.hosted && (await frame.count());
  let grown = false;
  const shot = async (target, settings, extra) => ({
    mime: 'image/png',
    scope: options.hosted ? 'reader-viewport' : 'local-viewport',
    base64: Buffer.from(await target.screenshot(settings)).toString('base64'),
    ...extra
  });
  const first = async partial => {
    if (grown) await page.setViewportSize(options.viewport);
    return shot(page, {fullPage: false, timeout: 1000}, partial && {partial});
  };
  // Hosted, page.evaluate runs in the reader's document frame, which scrolls inside the viewport.
  const measure = () =>
    page.evaluate(() => [document.documentElement.scrollHeight, innerHeight]).catch(() => [0, 0]);
  const [full, inner] = await measure();
  if (deck || full <= inner) return first();
  const height = Math.min(full, 8000),
    extra = {height, ...(full > height ? {partial: 'capped at 8000 px'} : {})};
  let result;
  if (hosted) {
    // The frame fills the viewport under the reader's bar: grow the viewport by what it scrolls.
    await page.setViewportSize({width, height: tall + height - inner});
    grown = true;
    const frames = () => new Promise(go => requestAnimationFrame(() => requestAnimationFrame(go)));
    await page.evaluate(frames);
    // A page sized by the viewport (100vh sections) grows with the frame: it is never whole.
    if ((await measure())[0] > full + 2)
      return first('first viewport only: the page sizes itself to the viewport');
    result = await shot(frame, {timeout: 3000}, extra);
  } else {
    const clip = {x: 0, y: 0, width, height};
    result = await shot(page, {fullPage: true, clip, timeout: 3000}, extra);
  }
  // The hosted session returns at most 8 MB.
  return result.base64.length > 5 * 1024 * 1024
    ? first('first viewport only: the whole page is too large to return')
    : result;
}
