/**
 * Example: check.mjs steps for examples/deck.html (a function body that receives page).
 * Usage: cp examples/deck-steps.mjs steps.mjs; set SLIDE_COUNT and CHART_COUNT to match SLIDES;
 *   node scripts/check.mjs index.html --viewport 1200x630 --viewport 1280x800 --steps steps.mjs
 * Gotchas: Vega bars are `.mark-rect path`, lines `.mark-line path`, points `.mark-symbol path`
 *   (never rect). Click script-made controls by [data-af-id]; dots are data-af-id="dot-<slide id>".
 */
const SLIDE_COUNT=8,CHART_COUNT=2,pad=n=>String(n).padStart(2,'0');
const at=n=>page.waitForFunction(text=>document.querySelector('#count').textContent===text,
  `${pad(n)} / ${pad(SLIDE_COUNT)}`,{timeout:3000});
await page.waitForFunction(([slides,charts])=>document.querySelectorAll('[data-af-slide]').length===
  slides&&document.querySelectorAll('.chart svg').length===charts,[SLIDE_COUNT,CHART_COUNT],
  {timeout:4000});
const marks=await page.locator('.chart .mark-rect path, .chart .mark-line path').count();
if(!marks)throw Error('charts drew no marks');
await page.getByRole('button',{name:'Next slide'}).click();await at(2);
await page.keyboard.press('End');await at(SLIDE_COUNT);
await page.keyboard.press('Home');await at(1);
await page.locator('[data-af-slide] [data-af-id$="-title"]').first().waitFor();
return {assertions:[`${SLIDE_COUNT} slides, ${CHART_COUNT} charts with marks`,
  'next, End and Home move the counter']};
