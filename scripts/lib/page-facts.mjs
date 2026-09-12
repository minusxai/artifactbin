/**
 * Facts about a rendered page that many gates ask for, asked ONE way.
 *
 * Each of these was written out by hand in eight to twenty-eight gates — the
 * same selector, the same arithmetic, occasionally off by one from its
 * neighbours. They are page FACTS, not verdicts: each returns a value, and the
 * gate says what the value has to be (lib/assert.mjs carries the verdict).
 */

/** The artifact iframe the app shell used to wrap a document in. */
const ARTIFACT_FRAME = 'iframe[title="artifact"]';

/** The story runtime, rendered INLINE into the served document. */
export const INLINE_STORY = '[data-mx-inline-story]';

/**
 * Was the document served as the page itself, rather than inside the app's
 * artifact frame? The delivery promise every reader-facing gate restates.
 * @param {import('playwright').Page} page
 */
export const servedTopLevel = async (page) => (await page.locator(ARTIFACT_FRAME).count()) === 0;

/**
 * How many pixels the page scrolls sideways (0 when it does not). A phone
 * layout that overflows by one pixel is a real fault and a rounding artefact
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
export const inlineStory = (page, options = {}) => page.waitForSelector(
  INLINE_STORY,
  { timeout: options.timeout ?? 30_000, ...(options.state ? { state: options.state } : {}) },
);
