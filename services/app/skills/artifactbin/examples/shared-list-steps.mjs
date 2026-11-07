/**
 * Example: check.mjs steps for examples/shared-list.html (a function body that receives page).
 * Usage: node scripts/new-app.mjs --kind list copies it as steps.mjs (and the -guest and -cleanup
 *   files); no edits needed: node scripts/check.mjs index.html --steps steps.mjs --guest-steps
 *   guest.mjs --cleanup-steps cleanup.mjs
 * Gotchas: the wide viewport adds TEST under the first choice, edits its note and re-reads it after
 *   a reload (the guest reads it next; cleanup.mjs removes it, even on failure). It fails on
 *   [placeholders] left in the page.
 */
const TEST='Check volunteer (test)',NOTE='edited by check';
const loaded=()=>page.waitForFunction(()=>document.querySelector('#lists')
  ?.getAttribute('aria-busy')==='false',null,{timeout:6000});
const status=()=>page.locator('#status').textContent();
const testRow=()=>page.locator('[data-af-id^="entry-"]').filter({has:page.getByText(TEST,
  {exact:true})});
await loaded();
await step('every choice has a section and signed-in people get the add form',async()=>{
  if(!await page.locator('#lists > section').count())throw Error('no choice sections');
  if(!await page.locator('#add').isVisible())throw Error('the add form is hidden for the owner');
  if((await page.locator('main').textContent()).includes('[')||(await page.title()).includes('['))
    throw Error('example text left in the page: replace every [bracketed] part of APP');});
if(page.viewportSize().width>800){
  await step(`"${TEST}" is added under the first choice`,async()=>{
    await page.locator('#add-name').fill(TEST);
    await page.locator('#add-button').click();
    await page.waitForFunction(()=>!/Saving/.test(document.querySelector('#status').textContent),
      null,{timeout:5000});
    if(!/^Added/.test(await status()))throw Error('add failed: '+await status());
    await page.locator('#lists > section').first().getByText(TEST,{exact:true})
      .waitFor({timeout:2000});});
  await step('its note is edited and survives a reload',async()=>{
    await testRow().getByRole('button',{name:'Edit '+TEST}).click();
    await page.locator('[data-af-id$="-note-input"]').fill(NOTE);
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.waitForFunction(()=>/^Saved/.test(document.querySelector('#status').textContent),
      null,{timeout:5000});
    await page.reload();await loaded();
    await testRow().getByText(NOTE).waitFor({timeout:2000});});
  return {steps:'wide'};
}
return {steps:'narrow'};
