/**
 * Example: check.mjs steps for examples/deck.html (a function body that receives page).
 * Usage: cp examples/deck-steps.mjs steps.mjs; set SLIDE_COUNT, CHART_COUNT and REAL (ids of
 *   slides with real:true) to match SLIDES; then node scripts/check.mjs index.html --viewport
 *   1200x630 --viewport 1280x800 --steps steps.mjs
 * Gotchas: each check is a step(label); the summary lists passing labels as Verified. Vega bars
 *   are `.mark-rect path`, lines `.mark-line path`. It fails while a [bracketed] placeholder is
 *   left (PLACEHOLDERS_OK is only for checking the template itself).
 */
const SLIDE_COUNT=8,CHART_COUNT=2,REAL=[],PLACEHOLDERS_OK=false,pad=n=>String(n).padStart(2,'0');
const at=n=>page.waitForFunction(text=>document.querySelector('#count').textContent===text,
  `${pad(n)} / ${pad(SLIDE_COUNT)}`,{timeout:3000});
await step(`${SLIDE_COUNT} slides and ${CHART_COUNT} charts render with marks`,async()=>{
  await page.waitForFunction(([slides,charts])=>document.querySelectorAll('[data-af-slide]')
    .length===slides&&document.querySelectorAll('.chart svg').length===charts,
    [SLIDE_COUNT,CHART_COUNT],{timeout:4000});
  if(!await page.locator('.chart .mark-rect path, .chart .mark-line path').count())
    throw Error('charts drew no marks');});
await step('flow and matrix diagrams draw',async()=>{
  const shapes=await page.evaluate(()=>[...document.querySelectorAll('.figure svg')]
    .map(svg=>svg.querySelectorAll('rect, circle').length));
  if(shapes.some(count=>!count))throw Error('a flow or matrix diagram drew nothing');});
await step('"Illustrative figures" on every slide with made-up figures',async()=>{
  // Slides with a chart or a digit in their copy carry the badge unless marked real.
  const missing=await page.evaluate(real=>[...document.querySelectorAll('[data-af-slide]')]
    .filter(slide=>!real.includes(slide.dataset.afId.replace(/^slide-/,''))&&(slide.querySelector(
      '.chart')||/\d/.test([...slide.querySelectorAll('h1,h2,.t-body-l,li,.t-numeral')].map(e=>
        e.textContent).join(' ')))&&!slide.querySelector('.illustrative')).map(s=>s.dataset.afId),
    REAL);
  if(missing.length)throw Error('no Illustrative figures badge on '+missing.join(', '));});
if(!PLACEHOLDERS_OK)await step('no [placeholders] left',async()=>{
  const left=await page.evaluate(()=>[...document.querySelectorAll('[data-af-slide]')]
    .filter(slide=>slide.textContent.includes('[')).map(slide=>slide.dataset.afId).concat(
      [document.title,document.querySelector('meta[name=description]')?.content??'']
        .some(text=>text.includes('['))?['the page title or description']:[]));
  if(left.length)throw Error('placeholders left on '+left.join(', '));});
await step('every title states only what its slide shows',async()=>{
// Every number and time or speed word in a title must be visible on its own slide (copy, value
// labels, axes: rendered text, not the data behind it). "A fifth" style fractions count as %.
const claims=await page.evaluate(()=>[...document.querySelectorAll('[data-af-slide]')]
  .flatMap((slide,n)=>{const title=slide.querySelector('h1,h2')?.textContent??'';
  if(title.includes('['))return [];
  const body=[...slide.querySelectorAll(':scope>:not(h1,h2)')].map(e=>e.textContent).join(' ')
    .toLowerCase(),num=t=>parseFloat(t.replace(/[$,]/g,''));
  const values=new Set((body.match(/\d[\d,]*\.?\d*/g)??[]).map(num));
  const parts={half:50,third:33,quarter:25,fifth:20,tenth:10},bad=[];
  for(const [word,pct] of Object.entries(parts))if(new RegExp(`\\b(a|one) ${word}\\b|\\b${word} of`)
    .test(title.toLowerCase())&&![...values].some(v=>Math.abs(v-pct)<=3))bad.push(`a ${word}`);
  for(const t of title.match(/\$?\d[\d,]*\.?\d*[a-z%×]*/gi)??[])if(!values.has(num(t)))bad.push(t);
  const time=new RegExp('\\b(seconds?|minutes?|hours?|days?|weeks?|months?|years?|mornings?|'+
    'afternoons?|evenings?|overnight|same-day|instant(ly)?|real-time|faster|cheaper|quicker)\\b',
    'g');
  for(const w of title.toLowerCase().match(time)??[])if(!body.includes(w.replace(/s$/,'')))
    bad.push(w);
  // Relative time ("a year ago", "since 2024", "YoY", "quarterly") needs its period on the slide.
  const rel=[[/\b(a year ago|last year|year[- ]over[- ]year|yoy|per year|annual(ly)?|this year)\b/,
    /year|annual|yoy|\b(19|20)\d\d\b/],
    [/\b(last quarter|quarterly|per quarter|qoq)\b/,/quarter|\bq[1-4]\b/],
    [/\b(last month|monthly|per month|mom)\b/,/month/],[/\bsince ((19|20)\d\d)\b/,null]];
  for(const [claim,need] of rel){const m=title.toLowerCase().match(claim);
    if(m&&!(need?need.test(body):body.includes(m[1])))bad.push(m[0]);}
  return bad.map(x=>`slide ${n+1} title claims '${x}' but the slide doesn't show it: put it on the`
    +' slide or drop it from the title');}));
if(claims.length)throw Error(claims.join('; '));});
await step('the ask shares add up to 100%',async()=>{
  const shares=await page.evaluate(()=>[...document.querySelectorAll('.ink li')].map(li=>
    li.textContent.match(/(\d+)%$/)?.[1]).filter(Boolean).map(Number));
  if(shares.length&&shares.reduce((a,b)=>a+b,0)!==100)throw Error('ask shares sum to '+shares);});
await step('next button, ArrowRight, End, Home and a dot move between slides',async()=>{
  await page.getByRole('button',{name:'Next slide'}).click();await at(2);
  await page.keyboard.press('ArrowRight');await at(3);
  await page.keyboard.press('End');await at(SLIDE_COUNT);
  await page.keyboard.press('Home');await at(1);
  await page.locator('#dots button').nth(3).click();await at(4);});
