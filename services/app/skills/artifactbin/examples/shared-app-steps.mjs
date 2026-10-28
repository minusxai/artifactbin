/**
 * Example: check.mjs steps for examples/shared-app.html (a function body that receives page).
 * Usage: cp examples/shared-app-steps.mjs steps.mjs (and the -guest and -cleanup files); set
 *   CATEGORY and TEST to match guest.mjs; node scripts/check.mjs index.html --steps steps.mjs
 *   --guest-steps guest.mjs --cleanup-steps cleanup.mjs
 * Gotchas: viewports run at once: the wide one saves TEST and leaves it for the guest to read
 *   (cleanup.mjs clears it afterwards, even on failure); the narrow one checks charts and the
 *   drill-down. Each check is a step(label) listed as Verified. It fails on [placeholders].
 */
const CATEGORY='Groceries',TEST='457',PLACEHOLDERS_OK=false;
const open=`[data-af-id="cat-${CATEGORY}-open"]`;
const shows=()=>page.waitForFunction(([sel,value])=>document.querySelector(sel)?.textContent
  .split(' of ')[1]?.replace(/[^\d.]/g,'').startsWith(value),[open,TEST],{timeout:4000});
await page.locator(open).waitFor({timeout:5000});
if(!PLACEHOLDERS_OK)await step('no example [placeholder] text left',async()=>{
  if((await page.locator('main').textContent()).includes('[')||await page.evaluate(()=>
    [document.title,document.querySelector('meta[name=description]')?.content??''].join()
      .includes('[')))
    throw Error('example text left in the page: replace every [bracketed] part');});
if(page.viewportSize().width>800){
  await step(`a ${CATEGORY} target of ${TEST} saves and survives a reload`,async()=>{
    await page.locator(open).click();await page.locator('#amount').fill(TEST);
    await page.getByRole('button',{name:/save target/i}).click();await shows();
    await page.getByRole('button',{name:/dark mode/i}).click();
    await page.waitForFunction(()=>document.documentElement.dataset.afDark==='true',null,
      {timeout:2000});
    await page.reload();await page.locator(open).waitFor({timeout:5000});await shows();});
  await step('this viewer\'s dark mode survives a reload',async()=>{
    if(await page.evaluate(()=>document.documentElement.dataset.afDark)!=='true')
      throw Error('dark mode not remembered after reload');});
  return {steps:'wide'};
}
await step('budgets are set, the trend has spent and budget for every month, payer bars draw',
  async()=>{
  await page.waitForFunction(()=>document.querySelectorAll('#trend svg, #payer svg').length===2,
    null,{timeout:4000});
  if(!/[1-9]/.test(await page.locator('#target').textContent()))
    throw Error('Target is zero: set APP.defaultTargets');
  const months=await page.locator('#month option').count();
  const points=await page.locator('#trend .mark-symbol.role-mark path').count();
  if(points!==2*months)throw Error(`trend has ${points} points for ${months} months`);
  if(!await page.locator('#payer .mark-rect.role-mark path').count())throw Error('no payer bar');});
await step(`${CATEGORY} opens its drill-down rows`,async()=>{
  await page.locator(open).click();
  await page.locator('[data-af-id^="row-"]').first().waitFor({timeout:3000});});
return {steps:'narrow'};
