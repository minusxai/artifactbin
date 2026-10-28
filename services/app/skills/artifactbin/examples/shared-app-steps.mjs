/**
 * Example: check.mjs steps for examples/shared-app.html (a function body that receives page).
 * Usage: cp examples/shared-app-steps.mjs steps.mjs; set CATEGORY to one of your categories, then
 *   node scripts/check.mjs index.html --steps steps.mjs --guest-steps guest.mjs
 * Gotchas: steps run once per viewport at the same time, so the write and reload run only on the
 *   wide viewport. Assert on [data-af-id] content (rendered, rounded text), case-insensitively;
 *   never on #status, which also reports loading and saves.
 */
const CATEGORY='Groceries',TARGET='450',wide=page.viewportSize().width>800,out=[];
const open=`[data-af-id="cat-${CATEGORY}-open"]`;
await page.locator(open).waitFor({timeout:5000});
await page.waitForFunction(()=>document.querySelectorAll('#trend svg, #payer svg').length===2,
  null,{timeout:4000});
out.push('spent '+(await page.locator('#spent').textContent()));
await page.locator(open).click();
await page.locator('[data-af-id^="row-"]').first().waitFor({timeout:3000});
out.push('drill-down rows: '+(await page.locator('#rows li').count()));
if(wide){
  await page.locator('#amount').fill(TARGET);
  await page.getByRole('button',{name:/save target/i}).click();
  await page.waitForFunction(([sel,value])=>document.querySelector(sel)?.textContent
    .split(' of ')[1]?.replace(/[^\d.]/g,'').startsWith(value),[open,TARGET],{timeout:4000});
  await page.getByRole('button',{name:/dark mode/i}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.afDark==='true',null,
    {timeout:2000});
  await page.reload();await page.locator(open).waitFor({timeout:5000});
  if(await page.evaluate(()=>document.documentElement.dataset.afDark)!=='true')
    throw Error('dark mode not remembered after reload');
  out.push('shared target saved; dark mode survives reload');
}
return {assertions:out};
