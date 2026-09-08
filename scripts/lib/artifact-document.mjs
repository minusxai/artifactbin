/** The artifact's actual document realm. Never fall back to a guessed child frame. */
export async function artifactDocument(page, options = {}) {
  // SSR has an inline-story child under its initial-story wrapper too. Only
  // the React root contains the hydrated runtime; wait until handoff reveals it.
  await page.locator('body > #root [data-mx-inline-story]').waitFor({ timeout: 30_000, ...options, state: 'visible' });
  return page.mainFrame();
}
