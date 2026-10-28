/**
 * Example: check.mjs steps for examples/deck.html (a function body that receives page).
 * Usage: cp examples/deck-steps.mjs steps.mjs; set SLIDE_COUNT, CHART_COUNT and REAL (ids of
 *   slides with real:true) to match SLIDES; then node scripts/check.mjs index.html --viewport
 *   1200x630 --viewport 1280x800 --steps steps.mjs
 * Gotchas: Vega bars are `.mark-rect path`, lines `.mark-line path`. It fails while a [bracketed]
 *   placeholder is left (PLACEHOLDERS_OK is only for checking the template itself).
 */
const SLIDE_COUNT=8,CHART_COUNT=2,REAL=[],PLACEHOLDERS_OK=false,pad=n=>String(n).padStart(2,'0');
const at=n=>page.waitForFunction(text=>document.querySelector('#count').textContent===text,
  `${pad(n)} / ${pad(SLIDE_COUNT)}`,{timeout:3000});
await page.waitForFunction(([slides,charts])=>document.querySelectorAll('[data-af-slide]').length===
  slides&&document.querySelectorAll('.chart svg').length===charts,[SLIDE_COUNT,CHART_COUNT],
  {timeout:4000});
const marks=await page.locator('.chart .mark-rect path, .chart .mark-line path').count();
if(!marks)throw Error('charts drew no marks');
const shapes=await page.evaluate(()=>[...document.querySelectorAll('.figure svg')]
  .map(svg=>svg.querySelectorAll('rect, circle').length));
if(shapes.some(count=>!count))throw Error('a flow or matrix diagram drew nothing');
const missing=await page.evaluate(real=>[...document.querySelectorAll('[data-af-slide]')]
  .filter(slide=>!real.includes(slide.dataset.afId.replace(/^slide-/,''))&&
    !slide.querySelector('.illustrative')).map(slide=>slide.dataset.afId),REAL);
if(missing.length)throw Error('no Illustrative figures badge on '+missing.join(', '));
const left=await page.evaluate(()=>[...document.querySelectorAll('[data-af-slide]')]
  .filter(slide=>slide.textContent.includes('[')).map(slide=>slide.dataset.afId));
if(left.length&&!PLACEHOLDERS_OK)throw Error('placeholders left on '+left.join(', '));
await page.getByRole('button',{name:'Next slide'}).click();await at(2);
await page.keyboard.press('End');await at(SLIDE_COUNT);
await page.keyboard.press('Home');await at(1);
return {assertions:[`${SLIDE_COUNT} slides, ${CHART_COUNT} charts with marks, ${shapes.length}`+
  ' diagrams drawn, badges where figures are made up, no placeholders',
  'next, End and Home move the counter']};
