/**
 * Example: check.mjs steps for examples/shared-app.html (a function body that receives page).
 * Usage: cp examples/shared-app-steps.mjs steps.mjs (and the -guest and -cleanup files); set
 *   CATEGORY and TEST to match guest.mjs; node scripts/check.mjs index.html --steps steps.mjs
 *   --guest-steps guest.mjs --cleanup-steps cleanup.mjs
 * Gotchas: viewports run at once, each within 8 s: the wide one saves TEST and re-reads it after a
 *   reload (the guest reads it next; cleanup.mjs clears it, even on failure); the narrow one checks
 *   charts, the drill-down and dark mode. Waits are on #status "Loaded…" and the target's own
 *   element (cat-NAME-target). Each check is a step(label) listed as Verified. It fails on
 *   [placeholders] and on stray text outside main.
 */
const CATEGORY='Groceries',TEST='457',PLACEHOLDERS_OK=false;
const open=`[data-af-id="cat-${CATEGORY}-open"]`,target=`[data-af-id="cat-${CATEGORY}-target"]`;
const status=()=>page.evaluate(()=>document.querySelector('#status')?.textContent??'');
const loaded=()=>page.waitForFunction(()=>/^Loaded/.test(document.querySelector('#status')
  ?.textContent),null,{timeout:6000});
// The saved target, read from its own element; a miss says what it saw.
const shows=async value=>{const read=()=>page.evaluate(sel=>document.querySelector(sel)
  ?.textContent.replace(/[^\d.]/g,'')??'',target);
  await page.waitForFunction(([sel,v])=>document.querySelector(sel)?.textContent
    .replace(/[^\d.]/g,'').startsWith(v),[target,value],{timeout:3000}).catch(()=>{});
  const saw=await read();if(!saw.startsWith(value))
    throw Error(`${CATEGORY} target: saw ${saw||'nothing'}, wanted ${value}`);};
await loaded();
// The page's own row count, so the Verified line carries the exact number.
const count=(await status()).match(/Loaded (\d+)/)?.[1];
await step(`page loaded ${count} sample transactions`,async()=>{
  if(!Number(count))throw Error('no rows loaded: '+await status());});
await step(PLACEHOLDERS_OK?'no stray text outside the app':'no [placeholder] or stray text left',
  async()=>{
  const stray=await page.evaluate(()=>{const walker=document.createTreeWalker(document.body,
    NodeFilter.SHOW_TEXT),out=[];for(let t=walker.nextNode();t;t=walker.nextNode())if(t.textContent
    .trim()&&!t.parentElement.closest('main,script,style,template,noscript'))
    out.push(t.textContent.trim().slice(0,40));return out;});
  if(stray.length)throw Error('stray text outside main: '+stray.map(t=>JSON.stringify(t))
    .join(', ')+' (an edited comment left behind?)');
  if(!PLACEHOLDERS_OK&&((await page.locator('main').textContent()).includes('[')||await page
    .evaluate(()=>[document.title,document.querySelector('meta[name=description]')?.content??'']
      .join().includes('['))))
    throw Error('example text left in the page: replace every [bracketed] part');});
if(page.viewportSize().width>800){
  await step(`a ${CATEGORY} target of ${TEST} saves and survives a reload`,async()=>{
    await page.locator(open).click();
    await page.locator(`#editor[data-for="${CATEGORY}"]`).waitFor({timeout:2000});
    await page.locator('#amount').fill(TEST);
    await page.getByRole('button',{name:/save target/i}).click();
    await page.waitForFunction(()=>!/Saving/.test(document.querySelector('#status').textContent),
      null,{timeout:5000});
    if(!/^Saved/.test(await status()))throw Error('save failed: '+await status());
    await shows(TEST);await page.reload();await loaded();await shows(TEST);});
  return {steps:'wide'};
}
await step('budgets are set, the trend has spent and budget for every month, in order, payer bars'+
  ' draw',async()=>{
  await page.waitForFunction(()=>document.querySelectorAll('#trend svg, #payer svg').length===2,
    null,{timeout:4000});
  if(!/[1-9]/.test(await page.locator('#target').textContent()))
    throw Error('Target is zero: set APP.defaultTargets');
  const months=await page.locator('#month option').count();
  const points=await page.locator('#trend .mark-symbol.role-mark path').count();
  if(points!==2*months)throw Error(`trend has ${points} points for ${months} months`);
  // The x labels follow the month selector's order (or read as dates in time order).
  const order=await page.evaluate(()=>{const options=[...document.querySelectorAll('#month option')]
    .map(o=>o.textContent.trim()),trend=document.querySelector('#trend');
    const x=[...trend.querySelectorAll('.role-axis')].find(g=>/^x-axis/i.test(g.getAttribute(
      'aria-label')??''));
    const labels=[...(x??trend).querySelectorAll('.role-axis-label text')].map(t=>t.textContent
      .trim()).filter(t=>x||!/^\$?[\d,.]+%?$/.test(t));
    const at=labels.map(l=>options.indexOf(l)),dates=labels.map(l=>Date.parse(l));
    const rising=list=>list.every((v,i)=>!i||v>list[i-1]);
    return labels.length&&(at.every(i=>i>=0)?rising(at):dates.every(d=>!isNaN(d))&&rising(dates))
      ?null:labels;});
  if(order)throw Error('trend months out of order: '+(order.slice(0,6).join(', ')||'no labels'));
  if(!await page.locator('#payer .mark-rect.role-mark path').count())throw Error('no payer bar');});
await step(`${CATEGORY} opens its drill-down rows`,async()=>{
  await page.locator(open).click();
  await page.locator('[data-af-id^="row-"]').first().waitFor({timeout:3000});});
await step('this viewer\'s dark mode survives a reload',async()=>{
  await page.getByRole('button',{name:/dark mode/i}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.afDark==='true',null,
    {timeout:2000});
  await page.reload();await loaded();
  if(await page.evaluate(()=>document.documentElement.dataset.afDark)!=='true')
    throw Error('dark mode not remembered after reload');});
return {steps:'narrow'};
