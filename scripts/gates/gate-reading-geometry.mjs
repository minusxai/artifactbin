/** Retained reader geometry on native author-owned HTML: stable first layout,
 * authored deck navigation, viewport-sized sections, responsive tables/charts,
 * phone chrome and scroll containment. Built-in kit rail/outline/tooltip and
 * source editor geometry retired with those surfaces. */
import {createChecker,createSection} from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import {launchChromium} from './lib/browser.mjs';
import {DOCUMENT_FRAME,documentFrame,horizontalOverflow} from './lib/page-facts.mjs';
import {openArtifactControls,openMenu} from './lib/reveal-chrome.mjs';
import {startDocument,becomeOwner} from '../lib/start-doc.mjs';
import {nativeHtml} from './lib/native-surface.mjs';
import {sleep} from './lib/sleep.mjs';
const BASE=process.argv[2]??'http://localhost:3030';
const check=createChecker('reading-geometry'),section=createSection(check),browser=await launchChromium();
const owner=await startDocument(BASE),auth={'Content-Type':'application/json',Authorization:`Bearer ${owner.token}`};
const table=`<div id="table-scroll" tabindex="0" aria-label="Wide data table"><table><thead><tr>${Array.from({length:12},(_,i)=>`<th>Column ${i+1}</th>`).join('')}</tr></thead><tbody><tr>${Array.from({length:12},(_,i)=>`<td>Value ${i+1}</td>`).join('')}</tr></tbody></table></div>`;
const html=nativeHtml('Native reading geometry',`<main><h1>Native reading geometry</h1><nav aria-label="Contents"><a href="#details">Details</a> <a href="#chart">Chart</a></nav><section id="details"><h2>Details</h2><p>First paragraph.</p><p>Second paragraph.</p>${table}</section><section id="chart"><h2>Chart</h2><svg id="responsive-chart" viewBox="0 0 640 240" role="img" aria-label="Quarterly chart"><path d="M30 20V210H620" stroke="currentColor" fill="none"/><rect x="70" y="90" width="80" height="120" fill="#36c"/><rect x="230" y="40" width="80" height="170" fill="#36c"/><rect x="390" y="70" width="80" height="140" fill="#36c"/><text x="70" y="232">Q1</text><text x="230" y="232">Q2</text><text x="390" y="232">Q3</text></svg></section></main>`,{
 css:'main{width:min(100%,960px);margin:0 auto;padding:24px}section{margin-top:48px;min-height:100svh}#table-scroll{overflow-x:auto;max-width:100%}table{border-collapse:collapse;min-width:1400px}td,th{padding:12px;white-space:nowrap;border:1px solid #bbb}svg{display:block;width:100%;height:auto}nav a{display:inline-block;min-height:44px;padding:12px}p{line-height:1.6;margin:24px 0}'
});
const saved=await fetch(`${BASE}/api/artifacts/${owner.id}`,{method:'PUT',headers:auth,body:JSON.stringify({html,visibility:'public'})});check(saved.status===200,'native responsive reading fixture publishes');
const deckRes=await fetch(`${BASE}/api/artifacts`,{method:'POST',headers:auth,body:JSON.stringify({visibility:'public',html:nativeHtml('Native deck',`<nav aria-label="Slides"><button data-slide="1">First</button><button data-slide="2">Second</button><button data-slide="3">Third</button></nav>${[1,2,3].map(n=>`<section id="slide-${n}" data-af-slide><h1>Slide ${n}</h1><p>Slide ${n} body</p></section>`).join('')}`,{
 css:'nav{position:sticky;top:0;background:white;z-index:1}button{min-height:44px}section{min-height:100svh;padding:48px;width:100%;border-bottom:1px solid #aaa}',
 script:`document.querySelectorAll('button[data-slide]').forEach(button=>button.onclick=()=>document.querySelector('#slide-'+button.dataset.slide).scrollIntoView({block:'start'}));`
})})});const deck=await deckRes.json();check(deckRes.status===201,'native authored deck publishes');
await section('desktop layout, tables and chart',async()=>{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(`${BASE}/a/${owner.id}`,{waitUntil:'domcontentloaded'});
 const frame=await documentFrame(page);await frame.locator('h1').waitFor();
 const positions=[];for(let i=0;i<8;i++){positions.push(await frame.locator('main').evaluate(el=>el.getBoundingClientRect().left));await sleep(100)}
 check(Math.max(...positions)-Math.min(...positions)<=1,'reader content left edge remains stable after first paint');
 const facts=await frame.evaluate(()=>{const main=document.querySelector('main').getBoundingClientRect(),svg=document.querySelector('svg').getBoundingClientRect(),table=document.querySelector('#table-scroll');return{mainWidth:main.width,chartWidth:svg.width,viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,tableOverflow:table.scrollWidth-table.clientWidth,ticks:document.querySelector('svg').textContent}});
 check(facts.mainWidth<=960&&facts.mainWidth>600,'native authored reading column retains desktop width');
 check(Math.abs(facts.chartWidth-(facts.mainWidth-48))<=2&&facts.ticks.includes('Q1')&&facts.ticks.includes('Q3'),'responsive chart paints at its actual content width with axis labels');
 check(facts.tableOverflow>100&&facts.overflow<=1,'wide table scrolls inside its column without page overflow');
 await frame.locator('#table-scroll').evaluate(el=>el.scrollLeft=500);check(await frame.locator('#table-scroll').evaluate(el=>el.scrollLeft)>0,'wide table is actually horizontally scrollable');
 await frame.getByRole('link',{name:'Chart',exact:true}).click();await sleep(200);
 const target=await frame.locator('#chart').evaluate(el=>el.getBoundingClientRect().top);check(target<200,'authored contents link navigates to its section');
 await page.close();
});
await section('native deck viewport and navigation',async()=>{
 const page=await browser.newPage({viewport:{width:1200,height:900}});await page.goto(`${BASE}/a/${deck.id}`,{waitUntil:'load'});const frame=await documentFrame(page);await frame.locator('#slide-1').waitFor();
 const measured=await frame.evaluate(()=>({viewport:innerHeight,section:document.querySelector('#slide-1').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth-innerWidth}));
 check(measured.section>=measured.viewport&&measured.section<=measured.viewport+4,'native viewport-height slide measures the frame viewport');
 check(measured.overflow<=1,'full-bleed authored slides do not create horizontal overflow');
 await frame.getByRole('button',{name:'Third',exact:true}).click();await sleep(200);
 check(await frame.locator('#slide-3').evaluate(el=>Math.abs(el.getBoundingClientRect().top))<5,'authored slide navigation reaches the requested slide');
 check(await page.locator(DOCUMENT_FRAME).count()===1,'deck retains original platform frame and chrome');await page.close();
});
await section('phone reading and original chrome',async()=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();await becomeOwner(page,BASE,owner.token);await page.goto(`${BASE}/a/${owner.id}`,{waitUntil:'load'});
 const frame=await documentFrame(page);await frame.locator('#responsive-chart').waitFor();
 check(await horizontalOverflow(page)<=1,'original reader shell fits the phone');
 check(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'native content, chart and table fit the phone');
 const column=await frame.locator('main').boundingBox(),chart=await frame.locator('svg').boundingBox();check(!!column&&!!chart&&chart.width<=column.width,'phone chart remains within its reading column');
 await openArtifactControls(page);const controls=page.getByLabel('Artifact controls',{exact:true});const box=await controls.boundingBox();check(!!box&&box.x>=0&&box.x+box.width<=390+1,'original artifact controls stay within phone bounds');
 await page.keyboard.press('Escape');await openMenu(page);const menu=page.getByRole('navigation',{name:'Menu',exact:true});const menuBox=await menu.boundingBox();check(!!menuBox&&menuBox.x>=0&&menuBox.x+menuBox.width<=391,'original navigation menu fits the phone');
 await page.keyboard.press('Escape');
 for(const path of [`/a/${deck.id}`,'/docs','/login']){await page.goto(`${BASE}${path}`,{waitUntil:'load'});check(await horizontalOverflow(page)<=1,`${path.startsWith('/a/')?'native deck':path} has no phone horizontal scroll`)}
 await context.close();
});
await browser.close();check.done();
