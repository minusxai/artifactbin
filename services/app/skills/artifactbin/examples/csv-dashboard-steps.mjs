/**
 * Example: check.mjs steps for examples/csv-dashboard.html (a function body that receives page).
 * Usage: cp examples/csv-dashboard-steps.mjs steps.mjs (no edits needed: it reads the counts from
 *   the page); then node scripts/check.mjs index.html --steps steps.mjs
 * Gotchas: it waits for #status "Computed N queries" (every DATA query answered through _sql),
 *   then checks that every DATA chart drew marks and a table, and that no [bracketed] starter text
 *   is left. Add a step for each requested number.
 */
const PLACEHOLDERS_OK=false;
const status=()=>page.evaluate(()=>document.querySelector('#status')?.textContent??'');
await page.waitForFunction(()=>/^Computed \d+ queries|Could not|error|allow/i.test(document
  .querySelector('#status')?.textContent??''),null,{timeout:6000}).catch(()=>{});
const count=(await status()).match(/^Computed (\d+) queries/)?.[1];
await step(`page computed its ${count} queries from the dataset`,async()=>{
  if(!Number(count))throw Error('no query answered: '+await status());});
await step('every chart draws marks and lists its values in a table',async()=>{
  const missing=await page.evaluate(()=>(window.DATA?.charts??[]).flatMap(c=>{
    const section=document.querySelector(`[data-af-id="chart-${c.id}"]`);
    const marks=section?.querySelectorAll('.mark-rect path, .mark-line path, .mark-symbol path')
      .length??0,rows=section?.querySelectorAll('table tr').length??0;
    return marks&&(rows>1||c.table===false)?[]:[`${c.id} (${marks} marks, ${Math.max(0,rows-1)}`+
      ' table rows)'];}));
  if(missing.length)throw Error('charts with no data: '+missing.join(', ')+
    ': check DATA x, y and where against the dataset columns');});
await step(PLACEHOLDERS_OK?'no stray text outside main':'no [placeholders] or stray text left',
  async()=>{
  const stray=await page.evaluate(()=>{const walker=document.createTreeWalker(document.body,
    NodeFilter.SHOW_TEXT),out=[];for(let t=walker.nextNode();t;t=walker.nextNode())if(t.textContent
    .trim()&&!t.parentElement.closest('main,script,style,template,noscript'))
    out.push(t.textContent.trim().slice(0,40));return out;});
  if(stray.length)throw Error('stray text outside main: '+stray.map(t=>JSON.stringify(t))
    .join(', ')+' (an edited comment left behind?)');
  if(PLACEHOLDERS_OK)return;
  const left=await page.evaluate(()=>[document.title,document.querySelector('main')?.textContent
    ??''].some(text=>/\[[^\]]*[a-z][^\]]*\]/i.test(text)));
  if(left)throw Error('starter text left in the page or <title>: replace every [bracketed]'+
    ' part');});
