/**
 * Example: check.mjs steps for examples/codebase-report.html (a function body that receives page).
 * Usage: new-codebase-report.mjs copies it as steps.mjs (no edits needed: it reads the page's
 *   DATA); then node scripts/check.mjs index.html --steps steps.mjs
 * Gotchas: it waits for #status "Computed N queries" (every DATA query answered through _sql),
 *   then checks that every finding has text and evidence, every Vega-Lite chart drew marks, the
 *   diagram drew its arrows, and that no [bracketed] starter text is left. Add a step for each
 *   requested number.
 */
const status=()=>page.evaluate(()=>document.querySelector('#status')?.textContent??'');
await page.waitForFunction(()=>/^Computed \d+ queries|Could not|error|allow/i.test(document
  .querySelector('#status')?.textContent??''),null,{timeout:6000}).catch(()=>{});
const count=(await status()).match(/^Computed (\d+) queries/)?.[1];
await step(`page computed its ${count} queries from the datasets`,async()=>{
  if(!Number(count))throw Error('no query answered: '+await status());});
await step('every finding states a number and links to its evidence',async()=>{
  const bad=await page.evaluate(()=>(window.DATA?.findings??[]).flatMap(f=>{
    const text=document.querySelector(`[data-af-id="finding-${f.id}-text"]`)?.textContent??'';
    const evidence=document.getElementById('chart-'+f.see);
    return /\d/.test(text)&&!/undefined|NaN/.test(text)&&evidence?[]:[`${f.id} ("${text
      .slice(0,60)}", evidence ${evidence?'found':'missing: see names no chart id'})`];}));
  if(bad.length)throw Error('findings without a number or evidence: '+bad.join('; '));});
await step('every chart draws marks and the diagram draws its arrows',async()=>{
  await page.waitForFunction(()=>(window.DATA?.charts??[]).every(c=>!c.diagram||document
    .querySelector(`[data-af-id="chart-${c.id}-plot"]`)?.dataset.drawn!==undefined),null,
  {timeout:4000}).catch(()=>{});
  const missing=await page.evaluate(()=>(window.DATA?.charts??[]).flatMap(c=>{
    const plot=document.querySelector(`[data-af-id="chart-${c.id}-plot"]`);
    if(c.diagram)return Number(plot?.dataset.drawn)>0&&plot.querySelector('svg')?[]:
      [`${c.id} (diagram: ${plot?.textContent.trim().slice(0,60)||'nothing drawn'})`];
    const marks=plot?.querySelectorAll('.mark-rect path, .mark-line path, .mark-symbol path')
      .length??0;
    return marks?[]:[`${c.id} (0 marks)`];}));
  if(missing.length)throw Error('charts with no data: '+missing.join(', ')+
    ': check each chart\'s query and fields against the dataset columns');});
await step('no [placeholders] or stray text left',async()=>{
  const stray=await page.evaluate(()=>{const walker=document.createTreeWalker(document.body,
    NodeFilter.SHOW_TEXT),out=[];for(let t=walker.nextNode();t;t=walker.nextNode())if(t.textContent
    .trim()&&!t.parentElement.closest('main,script,style,template,noscript'))
    out.push(t.textContent.trim().slice(0,40));return out;});
  if(stray.length)throw Error('stray text outside main: '+stray.map(t=>JSON.stringify(t))
    .join(', ')+' (an edited comment left behind?)');
  // Starter text is a [bracketed] phrase with a space; a path like app/[id]/page.tsx is not.
  const left=await page.evaluate(()=>[document.title,document.querySelector('main')?.textContent
    ??''].flatMap(text=>text.match(/\[[^\]\n]* [^\]\n]*\]/g)??[]).slice(0,3));
  if(left.length)throw Error('starter text left: '+left.map(t=>JSON.stringify(t.slice(0,50)))
    .join(', ')+': replace every [bracketed] part in DATA and <title>');});
