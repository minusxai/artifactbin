/**
 * Example: check.mjs steps for examples/api-dashboard.html (a function body that receives page).
 * Usage: node scripts/new-app.mjs --kind api copies it as steps.mjs (and the -guest and -cleanup
 *   files); no edits needed: node scripts/check.mjs index.html --steps steps.mjs --guest-steps
 *   guest.mjs --cleanup-steps cleanup.mjs
 * Gotchas: the wide viewport adds a TEST note through the first item's form, or through the
 *   page's notes API on a test item while no item loads (the API's key not set yet: check
 *   reports the items Not tested), and re-reads it after a reload; the guest reads it next and
 *   cleanup.mjs removes it, even on failure. It fails on [placeholders] left in the page.
 */
const TEST='Check note (test)';
const loaded=()=>page.waitForFunction(()=>document.querySelector('#board')
  ?.getAttribute('aria-busy')==='false',null,{timeout:8000});
const status=()=>page.locator('#status').textContent();
await loaded();
const items=await page.locator('#board li.item').count();
await step('the page lists its items by group with totals, or says why it cannot',async()=>{
  if((await page.locator('main').textContent()).includes('[')||(await page.title()).includes('['))
    throw Error('example text left in the page: replace every [bracketed] part of APP');
  if(!items&&!/API_KEY/.test(await status()))throw Error('no items: '+await status());
  const names=await page.locator('#board li.item strong').allTextContents();
  if(items&&!names.some(name=>name.trim()))
    throw Error("items have no names: set APP.fields to the API's field names");});
if(page.viewportSize().width>800){
  await step(`a note "${TEST}" is added and survives a reload`,async()=>{
    const form=page.locator('form.add-note').first();
    if(items){
      if(!await form.count())throw Error('a signed-in owner gets no note form');
      await form.locator('input').fill(TEST);await form.locator('button').click();
      await page.waitForFunction(()=>!/Saving/.test(document.querySelector('#status')
        .textContent),null,{timeout:5000});
      if(!/^Added/.test(await status()))throw Error('add failed: '+await status());
    }else{
      const failed=await page.evaluate(async note=>{const {client,gql}=await import(
        '@afbin/apollo');const result=await client.mutate({mutation:gql`mutation Add(
        $o:notes_insert_input!){insert_notes_one(object:$o){_id}}`,variables:{o:{
        item:'check-test',note}}});return result.errors?.[0]?.message??null;},TEST);
      if(failed)throw Error('add failed: '+failed);
    }
    await page.reload();await loaded();
    await page.getByText(TEST).first().waitFor({timeout:3000});});
  return {steps:'wide'};
}
return {steps:'narrow'};
