/**
 * Example: check.mjs cleanup steps for examples/shared-app.html: clears the test target.
 * Usage: cp examples/shared-app-cleanup.mjs cleanup.mjs (unchanged); pass it as --cleanup-steps.
 * Gotchas: an empty target field clears the saved target, so the APP.defaultTargets show again.
 */
// The category under test: the first one the page lists (so this file needs no edits).
const first=()=>document.querySelector('[data-af-id^="cat-"][data-af-id$="-open"]');
await page.waitForFunction(first,null,{timeout:6000});
const CATEGORY=await page.evaluate(()=>document.querySelector('[data-af-id^="cat-"]'+
  '[data-af-id$="-open"]').dataset.afId.slice(4,-5));
const open=`[data-af-id="cat-${CATEGORY}-open"]`;
await step(`the ${CATEGORY} test target is cleared back to its default`,async()=>{
  await page.waitForFunction(()=>/^Loaded/.test(document.querySelector('#status')?.textContent),
    null,{timeout:6000});
  await page.locator(open).click();
  await page.locator(`#editor[data-for="${CATEGORY}"]`).waitFor({timeout:2000});
  await page.locator('#amount').fill('');
  await page.getByRole('button',{name:/save target/i}).click();
  await page.waitForFunction(()=>/saved/i.test(document.querySelector('#status').textContent),
    null,{timeout:5000});});
return {steps:'cleanup'};
