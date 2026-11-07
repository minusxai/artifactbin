/**
 * Example: check.mjs steps for examples/tracker.html (a function body that receives page).
 * Usage: node scripts/new-app.mjs --kind tracker copies it as steps.mjs with only the chosen
 *   features' steps (and the -guest and -cleanup files); no edits needed: node scripts/check.mjs
 *   index.html --steps steps.mjs --guest-steps guest.mjs --cleanup-steps cleanup.mjs
 * Gotchas: the wide viewport adds TEST to the first group, edits it and re-reads it after a
 *   reload (the guest reads it next; cleanup.mjs removes every TEST entry, even on failure). It
 *   fails on [placeholders] left in the page.
 */
const TEST='Check entry (test)',NOTE='edited by check',TYPED='typed together';
const loaded=()=>page.waitForFunction(()=>document.querySelector('#lists')
  ?.getAttribute('aria-busy')==='false',null,{timeout:6000});
const status=()=>page.locator('#status').textContent();
const settled=()=>page.waitForFunction(()=>!/Saving/.test(document.querySelector('#status')
  .textContent),null,{timeout:5000});
const testRow=()=>page.locator('[data-af-id^="entry-"]').filter({has:page.getByText(TEST,
  {exact:true})});
await loaded();
await step('every group has a section and the owner gets the add form',async()=>{
  if(!await page.locator('#lists > section').count())throw Error('no group sections');
  if(!await page.locator('#add').isVisible())throw Error('the add form is hidden for the owner');
  if((await page.locator('main').textContent()).includes('[')||(await page.title()).includes('['))
    throw Error('example text left in the page: replace every [bracketed] part of APP');});
if(page.viewportSize().width>800){
  await step(`"${TEST}" is added to the first group`,async()=>{
    await page.locator('#add-name').fill(TEST);await page.locator('#add-button').click();
    await settled();
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
  // @feature collab
  // Typing is saved to the dataset about 5 s after its last editor leaves the page; until then
  //   the server keeps it live, so reopening the entry after a reload shows it (guest.mjs reads
  //   the save, made once this check's page closes).
  const synced=()=>page.waitForFunction(()=>document.querySelector(
    '[data-af-id$="-description-input"]')?.dataset.status==='synced',null,{timeout:3000});
  await step('its description is typed live and kept after a reload',async()=>{
    await testRow().getByRole('button',{name:'Edit '+TEST}).click();
    const area=page.locator('[data-af-id$="-description-input"]');
    await synced().catch(async()=>{throw Error(`the description is ${await area
      .getAttribute('data-status')}, not open for typing`);});
    await area.click();await page.keyboard.type(TYPED);await synced();
    await page.reload();await loaded();
    await testRow().getByRole('button',{name:'Edit '+TEST}).click();await synced();
    if(!(await area.inputValue()).includes(TYPED))
      throw Error('the typing was lost: '+JSON.stringify(await area.inputValue()));
    await page.getByRole('button',{name:'Cancel',exact:true}).click();});
  // @end collab
  // @feature table
  await step('the table view lists it and opens its form from a cell',async()=>{
    await page.getByRole('button',{name:'Table',exact:true}).click();
    const edit=page.getByRole('button',{name:`Edit ${TEST} in the table`}).first();
    await edit.waitFor({timeout:3000});await edit.click();
    await page.locator('[data-af-id$="-name-input"]').waitFor({timeout:3000});
    await page.getByRole('button',{name:'Cancel',exact:true}).click();});
  // @end table
  // @feature limits
  await step('a full group refuses one more entry',async()=>{
    const first=page.locator('#lists > section').first().locator('li[data-af-id^="entry-"]');
    const limit=await page.evaluate(()=>window.APP.limit);
    for(let i=await first.count();i<limit;i++){await page.locator('#add-name').fill(TEST);
      await page.locator('#add-button').click();await settled();}
    await page.locator('#add-name').fill(TEST);await page.locator('#add-button').click();
    await settled();
    if(!/full/.test(await status()))throw Error('the first group took more than its limit: '+
      await status());});
  // @end limits
  return {steps:'wide'};
}
return {steps:'narrow'};
