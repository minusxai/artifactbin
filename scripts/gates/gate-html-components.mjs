/** Targeted compiled-module checks. Recorded React SSR parity; candidate browser contracts and review images. */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { launchChromium } from './lib/browser.mjs';
import { createChecker } from './lib/assert.mjs';
import { semanticSnapshot, semanticDifferences, tabsParityFixtures, tabsInteractionHtml, tabsInteractionCases } from '../lib/component-parity.mjs';

const check = createChecker('html-components');
const repo = path.resolve(import.meta.dirname,'../..');
// These bytes are the real retained React capture, not a new expected DOM manufactured by this gate.
const oracleBytes = await readFile(path.join(repo,'services/app/lib/islands/__tests__/fixtures/react-oracle.json'));
const oracleHash = createHash('sha256').update(oracleBytes).digest('hex');
if (oracleHash !== 'fc56abeba44af903e616ed3172d5dddaad44c5c7b1afbc10ecf92078e10d468b') throw new Error('Recorded React reference changed: review and explicitly repin the capture');
const oracle = JSON.parse(oracleBytes);
const result = await build({stdin:{contents:"import {registerTabs} from './services/app/lib/html-components/tabs.ts';registerTabs();document.documentElement.dataset.fixtureReady='yes';",resolveDir:repo,sourcefile:'tabs-gate.ts'},bundle:true,format:'esm',platform:'browser',write:false});
const bundle = result.outputFiles[0].contents;
const server = createServer((request,response) => {
  if (request.url === '/tabs.js') { response.writeHead(200,{'content-type':'text/javascript'});response.end(bundle); }
  else { response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const screenshots = path.resolve(repo,process.argv[3] ?? 'tmp/component-parity');
await mkdir(screenshots,{recursive:true});
const browser = await launchChromium();
try {
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  async function mount(html,theme='light',viewport={width:800,height:600}) {
    await page.setViewportSize(viewport);
    await page.goto(origin);
    await page.setContent(`<!doctype html><html data-af-dark="${theme==='dark'}"><head><style>html{font-family:Arial,sans-serif;background:var(--background);color:var(--foreground)}body{padding:24px;margin:0}html{--background:#fff;--foreground:#18181b;--muted:#f4f4f5;--muted-foreground:#71717a;--primary:#2563eb;--primary-foreground:#fff;--ring:#2563eb}html[data-af-dark=true]{--background:#18181b;--foreground:#fafafa;--muted:#27272a;--muted-foreground:#a1a1aa;--primary:#60a5fa;--primary-foreground:#18181b;--ring:#93c5fd}</style></head><body>${html}<script type="module" src="/tabs.js"></script></body></html>`);
    await page.waitForFunction(()=>document.documentElement.dataset.fixtureReady==='yes');
    await page.evaluate(()=>document.fonts.ready);
  }
  for (const fixture of tabsParityFixtures()) {
    const recorded=oracle[fixture.reference.key];
    if (!recorded) throw new Error(`Missing recorded React fixture ${fixture.id}`);
    const expected=semanticSnapshot(new JSDOM(recorded).window.document);
    await mount(fixture.newHtml);
    const differences=semanticDifferences(expected,await page.evaluate(semanticSnapshot,await page.locator('body').elementHandle()));
    check(differences.length===0,`${fixture.id} recorded React SSR roles/name/selection (${differences.join('; ') || 'equal'})`);
  }
  for (const theme of ['light','dark']) for (const viewport of [{width:800,height:600},{width:375,height:667}]) {
    for (const fixtureCase of tabsInteractionCases) {
      await mount(tabsInteractionHtml,theme,viewport);
      for (const action of fixtureCase.actions) {
        if (action.type==='key') await page.keyboard.press(action.key);
        else await page.getByRole('tab',{name:action.name,exact:true})[action.type]();
      }
      const differences=semanticDifferences(fixtureCase.expected,await page.evaluate(semanticSnapshot,await page.locator('body').elementHandle()));
      check(differences.length===0,`candidate contract ${fixtureCase.id} ${theme} ${viewport.width}px (${differences.join('; ') || 'equal'})`);
    }
    // Real Tab traversal and retained content need a browser, not synthetic key dispatch.
    await mount(tabsInteractionHtml,theme,viewport);
    await page.locator('#before').focus(); await page.keyboard.press('Tab');
    check(await page.getByRole('tab',{name:'One',exact:true}).evaluate(node=>node===document.activeElement),`candidate Tab entry ${theme} ${viewport.width}px`);
    await page.keyboard.press('Shift+Tab');
    check(await page.locator('#before').evaluate(node=>node===document.activeElement),`candidate Shift+Tab exit ${theme} ${viewport.width}px`);
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Tab');
    check(await page.getByRole('tabpanel',{name:'Two',exact:true}).evaluate(node=>node===document.activeElement),`candidate Tab enters selected panel ${theme} ${viewport.width}px`);
    await page.getByRole('tab',{name:'One',exact:true}).click();
    await page.getByLabel('Retained input').fill('Edited');
    await page.getByRole('tab',{name:'Two',exact:true}).click(); await page.getByRole('tab',{name:'One',exact:true}).click();
    check(await page.getByLabel('Retained input').inputValue()==='Edited',`candidate panel keeps input ${theme} ${viewport.width}px`);
    await page.getByRole('tab',{name:'One',exact:true}).focus(); await page.keyboard.press('ArrowRight');
    await page.screenshot({path:path.join(screenshots,`candidate-tabs-${theme}-${viewport.width}.png`)});
    check(await page.getByRole('tab',{name:'Two',exact:true}).evaluate((node,expected)=>getComputedStyle(node).backgroundColor===expected,theme==='dark'?'rgb(96, 165, 250)':'rgb(37, 99, 235)'),`candidate selected theme token ${theme} ${viewport.width}px`);
    check(await page.evaluate(()=>[...document.querySelectorAll('[aria-controls],[aria-labelledby]')].every(node=>['aria-controls','aria-labelledby'].every(attr=>(node.getAttribute(attr)??'').split(/\s+/).filter(Boolean).every(id=>document.getElementById(id))))),`candidate ID references resolve ${theme} ${viewport.width}px`);
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`candidate no horizontal overflow ${theme} ${viewport.width}px`);
    check(await page.getByRole('tab',{name:'Two',exact:true}).evaluate(node=>{const style=getComputedStyle(node);return style.outlineStyle!=='none' && parseFloat(style.outlineWidth)>0;}),`candidate keyboard focus visible ${theme} ${viewport.width}px`);
  }
  check(errors.length===0,`candidate has no page errors (${errors.join('; ') || 'none'})`);
  await writeFile(path.join(screenshots,'evidence.json'),JSON.stringify({candidateBundleSha256:createHash('sha256').update(bundle).digest('hex'),reference:{kind:'recorded-react-ssr',sha256:oracleHash,fixtures:tabsParityFixtures().map(fixture=>({id:fixture.id,oldJsx:fixture.oldJsx,newHtml:fixture.newHtml}))},screenshots:'candidate-only; old-browser visual comparison not yet captured',themes:'fixture token pairs, not every product design system'},null,2));
  check.note(`Candidate review images: ${screenshots}; no old-browser screenshot comparison claimed`);
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
check.done();
