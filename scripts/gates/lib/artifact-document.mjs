import { documentFrame, INLINE_STORY } from './page-facts.mjs';

/**
 * The compiled reader's document realm: the document's frame on the app page (its own origin), or the page itself
 * when the page IS the document (/raw, a custom domain). Waits for the story to be visible inside it.
 */
export async function artifactDocument(page, options = {}) {
  const frame = await documentFrame(page, options);
  await frame.locator(INLINE_STORY).first().waitFor({ timeout: 30_000, ...options, state: 'visible' });
  return frame;
}
