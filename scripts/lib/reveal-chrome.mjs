/** Shared first-party chrome. Gates install gate-browser's test-only closed-root
 * getter before navigation; these are ordinary Playwright piercing locators.
 * Historical callers retain revealReaderChrome, but there is no reveal gesture
 * or frame relay: the persistent topbar must already be visibly actionable.
 */
export async function revealReaderChrome(target) {
  if(new URL(target.url()).pathname.endsWith('/raw'))return false; // capture/embed has no app UI
  await target.locator('[data-trusted-ui-root] [aria-label="Open menu"]').first().waitFor({state:'visible',timeout:30_000});
  return true;
}
export async function openArtifactControls(page,{timeout=30_000}={}) {
  await page.locator('[data-trusted-ui-root] [aria-label="Open artifact controls"], [data-trusted-ui-root] [aria-label="Open page controls"]').first().click({timeout});
}
export async function openMenu(page,{timeout=30_000}={}) {
  await page.locator('[data-trusted-ui-root] [aria-label="Open menu"]').first().click({timeout});
}
