/**
 * Facts about a rendered page that many gates ask for, asked ONE way.
 *
 * Each of these was written out by hand in eight to twenty-eight gates — the
 * same selector, the same arithmetic, occasionally off by one from its
 * neighbours. They are page FACTS, not verdicts: each returns a value, and the
 * gate says what the value has to be (lib/assert.mjs carries the verdict).
 */

/** The artifact iframe a wrapped document would sit in; a top-level delivery has none. */
const ARTIFACT_FRAME = 'iframe[title="artifact"]';

/** The story runtime, rendered INLINE into the served document (inside the document frame on the app page). */
export const INLINE_STORY = '[data-mx-inline-story]';

/** The frame the app page serves the document in, on the document's own origin. */
export const DOCUMENT_FRAME = 'iframe[data-mx-document-frame]';

/**
 * The document's frame as a Playwright Frame: wait for the app page to attach it and for its document to load.
 * A page that IS the document (custom-domain post, /raw) has no frame and is returned as its own main frame.
 * @param {import('playwright').Page} page
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<import('playwright').Frame>}
 */
export async function documentFrame(page, options = {}) {
  const timeout = options.timeout ?? 30_000;
  const iframe = page.locator(DOCUMENT_FRAME);
  if ((await iframe.count()) === 0) {
    try { await iframe.waitFor({ state: 'attached', timeout: Math.min(timeout, 5_000) }); } catch { return page.mainFrame(); }
  }
  const handle = await iframe.elementHandle({ timeout });
  const frame = await handle.contentFrame();
  if (!frame) throw new Error('the document frame has no content frame');
  await frame.waitForLoadState('domcontentloaded', { timeout });
  return frame;
}

/**
 * Locators scoped to the document: `documentLocator(page).locator('#figure')`.
 * @param {import('playwright').Page} page
 */
export const documentLocator = (page) => page.frameLocator(DOCUMENT_FRAME);

/**
 * Was the document served as the page itself, rather than inside the app's
 * artifact frame? The delivery promise every reader-facing gate restates.
 * @param {import('playwright').Page} page
 */
export const servedTopLevel = async (page) => (await page.locator(ARTIFACT_FRAME).count()) === 0;

/**
 * How many pixels the page scrolls sideways (0 when it does not). A phone
 * layout that overflows by one pixel is a real fault and a rounding artifact
 * is not, so the caller compares against a threshold it chooses.
 * @param {import('playwright').Page} page
 */
export const horizontalOverflow = (page) => page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);

/**
 * Wait for the inline story runtime to mount and hand back its element.
 * @param {import('playwright').Page} page
 * @param {{ timeout?: number, state?: 'attached' | 'visible' }} [options]
 */
export const inlineStory = async (page, options = {}) => (await documentFrame(page, options)).waitForSelector(
  INLINE_STORY,
  { timeout: options.timeout ?? 30_000, ...(options.state ? { state: options.state } : {}) },
);
