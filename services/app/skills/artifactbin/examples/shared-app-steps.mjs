/**
 * Example: check.mjs steps for examples/shared-app.html (a function body that receives page).
 * Usage: cp examples/shared-app-steps.mjs steps.mjs; set CATEGORY to one of your categories, then
 *   node scripts/check.mjs index.html --steps steps.mjs --guest-steps guest.mjs
 * Gotchas: viewports run at once, so the write runs on the wide one only and restores the original
 *   target (empty clears it). Assert on [data-af-id] text, case-insensitively, not on #status.
 */
const CATEGORY='Groceries',TARGET='450',wide=page.viewportSize().width>800,out=[];
const open=`[data-af-id="cat-${CATEGORY}-open"]`;
const goal=()=>page.waitForFunction(([sel,value])=>(document.querySelector(sel)?.textContent
  .split(' of ')[1]??'').replace(/[^\d.]/g,'').startsWith(value),[open,TARGET],{timeout:4000});
const save=async value=>{await page.locator('#amount').fill(value);
  await page.getByRole('button',{name:/save target/i}).click();};
await page.locator(open).waitFor({timeout:5000});
await page.waitForFunction(()=>document.querySelectorAll('#trend svg, #payer svg').length===2,
  null,{timeout:4000});
// An empty dashboard fails: real budgets, a point per month for spent and budget, payer bars.
const target=await page.locator('#target').textContent();
if(!/[1-9]/.test(target))throw Error('Target is zero: set APP.defaultTargets');
const months=await page.locator('#month option').count();
const points=await page.locator('#trend .mark-symbol.role-mark path').count();
if(points!==2*months)throw Error(`trend has ${points} points for ${months} months`);
if(!await page.locator('#payer .mark-rect.role-mark path').count())throw Error('no payer bars');
out.push(`spent ${await page.locator('#spent').textContent()} of ${target}; ${points} points`);
await page.locator(open).click();
await page.locator('[data-af-id^="row-"]').first().waitFor({timeout:3000});
out.push('drill-down rows: '+(await page.locator('#rows li').count()));
if(wide){
  const original=await page.locator('#amount').inputValue();
  await save(TARGET);await goal();
  await page.getByRole('button',{name:/dark mode/i}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.afDark==='true',null,
    {timeout:2000});
  await page.reload();await page.locator(open).waitFor({timeout:5000});
  if(await page.evaluate(()=>document.documentElement.dataset.afDark)!=='true')
    throw Error('dark mode not remembered after reload');
  await page.locator(open).click();await save(original);
  await page.waitForFunction(()=>/saved/i.test(document.querySelector('#status').textContent),null,
    {timeout:4000});
  out.push('shared target saved and restored; dark mode survives reload');
}
return {assertions:out};
