/**
 * Example: check.mjs guest steps for examples/tracker.html: a second, signed-out session sees the
 *   entry the signed-in steps added, gets no add form and no Edit or Remove on any entry.
 * Usage: node scripts/new-app.mjs --kind tracker copies it as guest.mjs (no edits needed; TEST
 *   equals the steps file's).
 * Gotchas: it proves a signed-out reader cannot write; a second signed-in account is not tried.
 */
const TEST='Check entry (test)';
await page.waitForFunction(()=>document.querySelector('#lists')?.getAttribute('aria-busy')===
  'false',null,{timeout:6000});
await step('a signed-out reader sees the list',async()=>{
  await page.getByText(TEST,{exact:true}).first().waitFor({timeout:2000});});
await step('a signed-out reader gets no add, edit or remove controls',async()=>{
  if(await page.locator('#add').isVisible())throw Error('a guest sees the add form');
  // @feature own-rows
  if(!await page.locator('#signin').isVisible())throw Error('no sign-in prompt for a guest');
  // @end own-rows
  const controls=await page.locator('[data-af-id$="-edit"],[data-af-id$="-remove"]').count();
  if(controls)throw Error(`a guest sees ${controls} edit or remove buttons`);});
// @feature collab
await step('a signed-out reader reads the description typed live, once it is saved',async()=>{
  // The typing is saved about 5 s after its editor leaves; the list refreshes when it lands.
  await page.getByText('typed together').first().waitFor({timeout:7000});});
// @end collab
return {steps:'guest'};
