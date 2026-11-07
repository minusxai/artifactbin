/**
 * Example: check.mjs guest steps for examples/shared-list.html: a second, signed-out session sees
 *   the entry the signed-in steps added, gets no add form and no Edit or Remove on any entry.
 * Usage: node scripts/new-app.mjs --kind list copies it as guest.mjs (no edits needed; TEST
 *   equals the steps file's).
 * Gotchas: it proves a signed-out reader cannot write; a second signed-in account is not tried.
 */
const TEST='Check volunteer (test)';
await page.waitForFunction(()=>document.querySelector('#lists')?.getAttribute('aria-busy')===
  'false',null,{timeout:6000});
await step('a signed-out reader sees the list',async()=>{
  await page.getByText(TEST,{exact:true}).waitFor({timeout:2000});});
await step('a signed-out reader gets a sign-in prompt and no add, edit or remove controls',
  async()=>{
  if(await page.locator('#add').isVisible())throw Error('a guest sees the add form');
  if(!await page.locator('#signin').isVisible())throw Error('no sign-in prompt for a guest');
  const controls=await page.locator('[data-af-id$="-edit"],[data-af-id$="-remove"]').count();
  if(controls)throw Error(`a guest sees ${controls} edit or remove buttons`);});
return {steps:'guest'};
