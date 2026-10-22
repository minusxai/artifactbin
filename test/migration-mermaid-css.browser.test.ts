import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {sanitizeMermaidSvg} from '../src/migration/conversion/compiled/mermaid-svg.ts';
test('sanitized Mermaid CSS cannot load image functions, escaped resources or inherited paint',async()=>{
 const declarations=['background-image:image-set("https://example.invalid/image.svg" 1x)','background:-webkit-image-set("https://example.invalid/image.svg" 1x)','fill:u\\72l("https://example.invalid/image.svg")','fill:var(--outside-paint)','fill:inherit'];
 const output:string[]=[];let rejected=0;
 for(const declaration of declarations){try{output.push(sanitizeMermaidSvg('<svg id="seq" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><style>#seq{'+declaration+'}</style><rect width="100" height="20"/></svg>').svg);}catch{rejected++;}}
 const safe=sanitizeMermaidSvg('<svg id="safe" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><style>#safe{fill:rgba(20,40,60,.5);filter:drop-shadow(0 1px 2px rgba(0,0,0,.2))}</style><text x="5" y="15">Saved</text></svg>').svg;
 const browser=await chromium.launch();try{const page=await browser.newPage(),requests:string[]=[];await page.route('**/*',route=>{requests.push(new URL(route.request().url()).protocol);return route.abort();});await page.setContent('<div style="--outside-paint:url(https://example.invalid/paint.svg)">'+output.join('')+safe+'</div>');await page.waitForTimeout(150);assert.deepEqual(requests,[]);assert.equal(rejected,declarations.length);assert.equal(await page.locator('svg').count(),1);assert.equal(await page.locator('#safe text').textContent(),'Saved');assert.equal(await page.locator('#safe').evaluate(el=>getComputedStyle(el).fill),'rgba(20, 40, 60, 0.5)');}finally{await browser.close();}
});
test('local inherited stroke is isolated from page resources and preserves descendant paint',async()=>{
 const safe=sanitizeMermaidSvg('<svg id="local" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><style>#local text{stroke:inherit}</style><text id="plain">Plain</text><g stroke="red"><text id="red">Red</text></g></svg>').svg;
 assert.equal(sanitizeMermaidSvg(safe).svg,safe);
 for(const payload of ['<style>#local{stroke:inherit!important}</style>','<style>#local:hover{stroke:red}</style>','<style>#local:has(g g){stroke:inherit!important}</style>'])assert.throws(()=>sanitizeMermaidSvg('<svg id="local" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">'+payload+'</svg>'));
 const browser=await chromium.launch();try{const page=await browser.newPage(),requests:string[]=[];await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});await page.setContent('<div id="host" style="stroke:url(https://example.invalid/paint.svg)"></div>');await page.waitForTimeout(50);requests.length=0;await page.locator('#host').evaluate((el,svg)=>{el.innerHTML=svg;},safe);assert.equal(await page.locator('#plain').evaluate(el=>getComputedStyle(el).stroke),'none');assert.equal(await page.locator('#red').evaluate(el=>getComputedStyle(el).stroke),'rgb(255, 0, 0)');assert.deepEqual(requests,[]);}finally{await browser.close();}
});
