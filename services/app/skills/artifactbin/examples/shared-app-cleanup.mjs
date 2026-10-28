/**
 * Example: check.mjs cleanup steps for examples/shared-app.html: clears the test target.
 * Usage: cp examples/shared-app-cleanup.mjs cleanup.mjs; keep CATEGORY equal to steps.mjs; pass it
 *   as --cleanup-steps (check.mjs runs it signed in after the other steps, even when they fail).
 * Gotchas: an empty target field clears the saved target, so the APP.defaultTargets show again.
 */
const CATEGORY='Groceries',open=`[data-af-id="cat-${CATEGORY}-open"]`;
await step(`the ${CATEGORY} test target is cleared back to its default`,async()=>{
  await page.locator(open).waitFor({timeout:5000});await page.locator(open).click();
  await page.locator('#amount').fill('');
  await page.getByRole('button',{name:/save target/i}).click();
  await page.waitForFunction(()=>/saved/i.test(document.querySelector('#status').textContent),
    null,{timeout:4000});});
return {steps:'cleanup'};
