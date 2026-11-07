/**
 * Example: check.mjs guest steps for examples/api-dashboard.html: a second, signed-out session
 *   reads the note the signed-in steps added and gets no note form and no Remove.
 * Usage: node scripts/new-app.mjs --kind api copies it as guest.mjs (no edits needed; TEST equals
 *   the steps file's).
 * Gotchas: it proves a signed-out reader cannot write; a second signed-in account is not tried.
 */
const TEST='Check note (test)';
await page.waitForFunction(()=>document.querySelector('#board')?.getAttribute('aria-busy')===
  'false',null,{timeout:8000});
await step('a signed-out reader sees the notes',async()=>{
  await page.getByText(TEST).first().waitFor({timeout:3000});});
await step('a signed-out reader gets a sign-in prompt and no note form or Remove',async()=>{
  if(!await page.locator('#signin').isVisible())throw Error('no sign-in prompt for a guest');
  const controls=await page.locator('form.add-note,[data-af-id$="-remove"]').count();
  if(controls)throw Error(`a guest sees ${controls} note forms or Remove buttons`);});
return {steps:'guest'};
