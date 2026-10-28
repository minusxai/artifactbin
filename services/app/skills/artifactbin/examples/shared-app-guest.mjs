/**
 * Example: check.mjs guest steps for examples/shared-app.html: a signed-out reader sees the shared,
 *   seeded targets, not the signed-in viewer's dark mode, and cannot save.
 * Usage: cp examples/shared-app-guest.mjs guest.mjs; set CATEGORY, then pass it as --guest-steps.
 * Gotchas: it runs after the self steps finish, on the wide viewport only.
 */
if(page.viewportSize().width<800)return {assertions:['guest checks run on the wide viewport']};
const CATEGORY='Rent',open=`[data-af-id="cat-${CATEGORY}-open"]`;
await page.locator(open).waitFor({timeout:5000});
if(!/[1-9]/.test(await page.locator('#target').textContent()))throw Error('guest sees no targets');
if(await page.evaluate(()=>document.documentElement.dataset.afDark)==='true')
  throw Error('dark mode leaked to another viewer');
await page.locator(open).click();
const save=page.locator('#editor button');
if(!await save.isDisabled()||!/sign in/i.test(await save.textContent()))
  throw Error('a guest can press Save');
return {assertions:['a guest sees shared targets, light mode and a disabled "Sign in to edit"']};
