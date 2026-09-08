/** The artifact's actual document realm. Never fall back to a guessed child frame. */
export async function artifactDocument(page, options = {}) {
  await page.locator('[data-mx-inline-story]:not([data-mx-initial-story])').waitFor({ state: 'attached', timeout: 30_000, ...options });
  return page.mainFrame();
}
