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
await step('every title states only what its slide shows',async()=>{
// Every number and time word in a title must be visible on its own slide (copy, value labels,
// axes: rendered text, read node by node so SVG ticks don't fuse). Fractions count as %.
const claims=await page.evaluate(()=>[...document.querySelectorAll('[data-af-slide]')]
  .flatMap((slide,n)=>{const heading=slide.querySelector('h1,h2'),title=heading?.textContent??'';
  if(title.includes('['))return [];
  const walker=document.createTreeWalker(slide,NodeFilter.SHOW_TEXT),nodes=[];
  for(let t=walker.nextNode();t;t=walker.nextNode())if(!heading?.contains(t)&&t.textContent.trim())
    nodes.push(t.textContent.trim().toLowerCase());
  const body=nodes.join(' '),num=t=>parseFloat(t.replace(/[$,]/g,'')),low=title.toLowerCase();
  const seen=[...new Set((body.match(/\d[\d,]*\.?\d*/g)??[]).map(num))],values=new Set(seen),bad=[];
  const parts={half:50,third:33,quarter:25,fifth:20,tenth:10},words=low.match(/[a-z0-9-]+/g)??[];
  for(const [word,pct] of Object.entries(parts))if(new RegExp(`\\b(a|one) ${word}\\b|\\b${word} of`)
    .test(low)&&!seen.some(v=>Math.abs(v-pct)<=3))bad.push(`a ${word}`);
  for(const t of title.match(/\$?\d[\d,]*\.?\d*[a-z%×]*/gi)??[])if(!values.has(num(t)))bad.push(t);
  // A time word needs the same form in one visible element, beside a number or a title neighbour.
  const time=new RegExp('^(seconds?|minutes?|hours?|days?|weeks?|months?|years?|mornings?|'+
    'afternoons?|evenings?|nights?|weekends?|shifts?|seasons?|cycles?|sprints?|visits?|trips?|'+
    'overnight|same-day|instant(ly)?|real-time|faster|cheaper|quicker|today|now|currently)$'),
    stop=new Set(['the','and','not','for','but','with','from','than','that','this','our','its',
    'your','are','was','has','have','into']),handled=new Set();
  // "in one shift", "within a single visit", "under two weeks": a duration when the noun after the
  // quantity is a time word. Its unit needs the same form beside a number or quantity word in one
  // visible element ("in one dashboard" or "in one clamp-on unit" is not a duration).
  const Q='a few|a couple of|several|an|a|one|two|three|four|five|six|seven|eight|nine|ten|\\d+';
  const qty=new RegExp(`\\d|\\b(${Q}|single)\\b`);
  for(const m of low.matchAll(new RegExp(`\\b(?:in|within|under|inside|over) (?:${Q}) (?:(?:`+
    'single|full|whole|short|working|business) )?([a-z-]+)','g'))){const unit=m[1];
    if(!time.test(unit))continue;handled.add(unit);
    if(!nodes.some(node=>new RegExp(`\\b${unit}\\b`).test(node)&&qty.test(node)))bad.push(m[0]);}
  words.forEach((w,i)=>{if(!time.test(w)||handled.has(w))return;
    const near=[words[i-1],words[i+1]].filter(x=>x&&x.length>2&&!stop.has(x));
    if(!nodes.some(node=>new RegExp(`\\b${w}\\b`).test(node)&&(/\d/.test(node)||near.some(x=>
      new RegExp(`\\b${x}\\b`).test(node)))))bad.push(w);});
  // Relative time ("a year ago", "since 2024", "YoY", "so far") needs its period on the slide.
  const rel=[[/\b(a year ago|last year|year[- ]over[- ]year|yoy|per year|annual(ly)?)\b/,
    /year|annual|yoy|\b(19|20)\d\d\b/],
    [/\b(last quarter|quarterly|per quarter|qoq)\b/,/quarter|\bq[1-4]\b/],
    [/\b(last month|monthly|per month|mom)\b/,/month/],[/\bsince ((19|20)\d\d)\b/,null],
    [/\b(this (?:year|quarter|month)|within a year|so far|to date)\b/,null]];
  for(const [claim,need] of rel){const m=low.match(claim);
    if(m&&!(need?need.test(body):body.includes(m[1])))bad.push(m[0]);}
  return bad.map(x=>`slide ${n+1} title claims '${x}' but the slide doesn't show it (numbers on`+
    ` slide: ${seen.slice(0,12).join(', ')||'none'}): put it on the slide or drop it from the`+
    ' title');
  }));
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
