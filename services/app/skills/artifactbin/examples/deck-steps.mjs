/**
 * Example: check.mjs steps for examples/deck.html (a function body that receives page).
 * Usage: cp examples/deck-steps.mjs steps.mjs (no edits needed: it reads the slide and chart
 *   counts from the page's SLIDES); then node scripts/check.mjs index.html --steps steps.mjs
 * Gotchas: it fails while a [bracketed] placeholder is left (PLACEHOLDERS_OK is only for checking
 *   the template itself) and when a chart slide that names dataset columns read no rows.
 */
const PLACEHOLDERS_OK=false,pad=n=>String(n).padStart(2,'0');
const {SLIDE_COUNT,CHART_COUNT,REAL}=await page.evaluate(()=>{const all=window.SLIDES??[];
  return {SLIDE_COUNT:all.length,CHART_COUNT:all.filter(s=>s.type==='chart').length,
    REAL:all.filter(s=>s.real).map(s=>s.id)};});
// Chart slides naming dataset columns, read once the slides (drawn after the rows load) are there.
const fromDataset=()=>page.evaluate(()=>window.DATA?.dataset?(window.SLIDES??[]).filter(s=>
  s.type==='chart'&&typeof s.y==='string').map(s=>({id:s.id,rows:s.data?.length??0,
  error:s.error})):[]);
const at=n=>page.waitForFunction(text=>document.querySelector('#count').textContent===text,
  `${pad(n)} / ${pad(SLIDE_COUNT)}`,{timeout:2000});
await step(`${SLIDE_COUNT} slides and ${CHART_COUNT} charts render with marks`,async()=>{
  await page.waitForFunction(([slides,charts])=>document.querySelectorAll('[data-af-slide]')
    .length===slides&&document.querySelectorAll('.chart svg').length===charts,
    [SLIDE_COUNT,CHART_COUNT],{timeout:6000});
  if(CHART_COUNT&&!await page.locator('.chart .mark-rect path, .chart .mark-line path').count())
    throw Error('charts drew no marks');});
const FROM_DATASET=await fromDataset();
if(FROM_DATASET.length)await step(`${FROM_DATASET.length} chart slides read the linked dataset`,
  async()=>{const empty=FROM_DATASET.filter(c=>!c.rows);
  if(empty.length)throw Error('no dataset rows on '+empty.map(c=>c.error??
    `${c.id}: check its x and y against the dataset columns`).join('; '));});
await step('flow and matrix diagrams draw',async()=>{
  const shapes=await page.evaluate(()=>[...document.querySelectorAll('.figure svg')]
    .map(svg=>svg.querySelectorAll('rect, circle').length));
  if(shapes.some(count=>!count))throw Error('a flow or matrix diagram drew nothing');});
await step('"Illustrative figures" on every slide',async()=>{
  // Every slide carries the badge unless marked real.
  const missing=await page.evaluate(real=>[...document.querySelectorAll('[data-af-slide]')]
    .filter(slide=>!real.includes(slide.dataset.afId.replace(/^slide-/,''))&&
      !slide.querySelector('.illustrative')).map(s=>s.dataset.afId),REAL);
  if(missing.length)throw Error('no Illustrative figures badge on '+missing.join(', '));});
await step(PLACEHOLDERS_OK?'no stray text outside the slides':
  'no [placeholders] or stray text left',async()=>{
  // Text outside the slides and the deck nav (a "-->" left by an edited comment) shows on the page.
  const stray=await page.evaluate(()=>{const walker=document.createTreeWalker(document.body,
    NodeFilter.SHOW_TEXT),out=[];for(let t=walker.nextNode();t;t=walker.nextNode())if(t.textContent
    .trim()&&!t.parentElement.closest('[data-af-slide],nav,script,style,template,noscript'))
    out.push(t.textContent.trim().slice(0,40));return out;});
  if(stray.length)throw Error('stray text outside the slides: '+stray.map(t=>JSON.stringify(t))
    .join(', ')+' (an edited comment left behind?)');
  if(PLACEHOLDERS_OK)return;
  const left=await page.evaluate(()=>[...document.querySelectorAll('[data-af-slide]')]
    .filter(slide=>slide.textContent.includes('[')).map(slide=>slide.dataset.afId).concat(
      [document.title,document.querySelector('meta[name=description]')?.content??'']
        .some(text=>text.includes('['))?['the page title or description']:[]));
  if(left.length)throw Error('placeholders left on '+left.join(', '));});
await step('next button, ArrowRight, End, Home and a dot move between slides',async()=>{
  await page.getByRole('button',{name:'Next slide'}).click();await at(2);
  await page.keyboard.press('ArrowRight');await at(3);
  await page.keyboard.press('End');await at(SLIDE_COUNT);
  await page.keyboard.press('Home');await at(1);
  await page.locator('#dots button').nth(3).click();await at(4);});
