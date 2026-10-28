/**
 * Example: check.mjs guest steps for examples/shared-app.html: a second, signed-out session reads
 *   the target the signed-in steps saved, cannot save, and keeps its own light mode.
 * Usage: cp examples/shared-app-guest.mjs guest.mjs; keep CATEGORY and TEST equal to steps.mjs.
 * Gotchas: it runs after the self steps, on the wide viewport only. It proves read access for
 *   another session, not sharing between two signed-in users.
 */
const CATEGORY='Groceries',TEST='457',open=`[data-af-id="cat-${CATEGORY}-open"]`;
await page.locator(open).waitFor({timeout:5000});
await step('shared target visible to a second (guest) session',async()=>{
  const shown=(await page.locator(open).textContent()).split(' of ')[1]?.replace(/[^\d.]/g,'');
  if(!shown?.startsWith(TEST))throw Error(`guest sees ${shown} for ${CATEGORY}, not ${TEST}`);});
await step('a guest cannot save and keeps light mode',async()=>{
  if(await page.evaluate(()=>document.documentElement.dataset.afDark)==='true')
    throw Error('dark mode leaked to another viewer');
  await page.locator(open).click();
  const save=page.locator('#editor button');
  if(!await save.isDisabled()||!/sign in/i.test(await save.textContent()))
    throw Error('a guest can press Save');});
return {steps:'guest'};
