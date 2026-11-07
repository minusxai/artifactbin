/**
 * Internal: check.mjs's saved screenshot, serialized into the hosted script like the other PARTS:
 * it references only its own parameters.
 * Used by: toolbox-check-inspect.mjs (PARTS).
 */

/** The document's full height at the viewport's width, up to 8000 px. A deck, a page that fits
 * and one that cannot be captured whole keep the viewport; `partial` says why it is not whole.
 * With options.slides a deck adds each laid-out slide (`slides`; `slidesPartial` says why any is
 * missing). */
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
  const frames = () => new Promise(go => requestAnimationFrame(() => requestAnimationFrame(go)));
  const [full, inner] = await measure();
  if (deck && options.slides) return {...(await first()), ...(await slides())};
  if (deck || full <= inner) return first();
  const height = Math.min(full, 8000),
    extra = {height, ...(full > height ? {partial: 'capped at 8000 px'} : {})};
  let result;
  if (hosted) {
    // The frame fills the viewport under the reader's bar: grow the viewport by what it scrolls.
    await page.setViewportSize({width, height: tall + height - inner});
    grown = true;
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
  // Each slide the slides probe counts, as slide export draws it (deck chrome hidden), at the
  // viewport's size: hosted, the frame first grows by the reader's bar. Up to 20 slides, 6 MB
  // of PNG and 5 s, so the result fits what a hosted script returns within its time.
  async function slides() {
    if (hosted && inner < tall) {
      await page.setViewportSize({width, height: 2 * tall - inner});
      await page.evaluate(frames);
    }
    const all = page.locator('[data-af-slide]');
    const laid = await all.evaluateAll(els => els.flatMap((el, i) => {
      const box = el.getBoundingClientRect();
      return !el.closest('[data-af-deck-chrome]') && box.width > 1 && box.height > 1 ? [i] : [];
    }));
    // Drawn alone, as slide export draws it (services/browser/src/local.ts, the same rule): a
    // stacked deck hides all but its active slide.
    const style = '[data-af-deck-chrome],[data-af-deck-chrome] *{visibility:hidden!important}' +
      '[data-af-slide]{transition:none!important;animation:none!important}' +
      '[data-af-slide]:not([data-af-slide-shot]){visibility:hidden!important;opacity:0!important}' +
      '[data-af-slide-shot]{visibility:visible!important;opacity:1!important}';
    const shots = [], end = Date.now() + 5000;
    let size = 0, why = '';
    for (const i of laid.slice(0, 20)) {
      if (Date.now() > end) { why = ': out of time'; break; }
      try {
        const one = all.nth(i);
        await one.evaluate(el => el.setAttribute('data-af-slide-shot', ''));
        const png = Buffer.from(await one.screenshot({style, timeout: 1500}).finally(() =>
          one.evaluate(el => el.removeAttribute('data-af-slide-shot')).catch(() => {})));
        const base64 = png.toString('base64');
        if ((size += base64.length) > 6 * 1024 * 1024) { why = ': the rest are too large'; break; }
        shots.push({base64, width: png.readUInt32BE(16), height: png.readUInt32BE(20)});
      } catch (error) {
        why = ': ' + String(error.message).split('\n')[0].slice(0, 120);
        break;
      }
    }
    const partial = `first ${shots.length} of ${laid.length} slides${why}`;
    return {slides: shots, ...(shots.length < laid.length ? {slidesPartial: partial} : {})};
  }
}
