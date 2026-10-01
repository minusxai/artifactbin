/** The compiled reader's actual top-level document realm. */
export async function artifactDocument(page, options = {}) {
  await page.locator('[data-mx-inline-story]').first().waitFor({ timeout: 30_000, ...options, state: 'visible' });
  return page.mainFrame();
}
