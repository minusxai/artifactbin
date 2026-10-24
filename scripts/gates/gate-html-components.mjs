/** Targeted compiled-module checks. Recorded React SSR parity; candidate browser contracts and review images. */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { launchChromium } from './lib/browser.mjs';
import { createChecker, createSection } from './lib/assert.mjs';
import { semanticSnapshot, semanticDifferences, tabsParityFixtures, tabsInteractionHtml, tabsInteractionCases, componentBrowserFixtures, contrastRatio } from '../lib/component-parity.mjs';

const check = createChecker('html-components');
const section = createSection(check);
const evidenceFiles = [];
const families=['Tabs','Button','Switch','Progress','Collapsible','Dialog','Slider','Input','Textarea'];
const repo = path.resolve(import.meta.dirname,'../..');
// These bytes are the real retained React capture, not a new expected DOM manufactured by this gate.
const oracleBytes = await readFile(path.join(repo,'services/app/lib/islands/__tests__/fixtures/react-oracle.json'));
const oracleHash = createHash('sha256').update(oracleBytes).digest('hex');
if (oracleHash !== 'fc56abeba44af903e616ed3172d5dddaad44c5c7b1afbc10ecf92078e10d468b') throw new Error('Recorded React reference changed: review and explicitly repin the capture');
const oracle = JSON.parse(oracleBytes);
const result = await build({stdin:{contents:families.map(family=>`import {register${family}} from './services/app/lib/html-components/${family.toLowerCase()}.ts';register${family}();`).join('')+"document.documentElement.dataset.fixtureReady='yes';",resolveDir:repo,sourcefile:'components-gate.ts'},bundle:true,format:'esm',platform:'browser',write:false});
const bundle = result.outputFiles[0].contents;
const server = createServer((request,response) => {
  if (request.url === '/components.js') { response.writeHead(200,{'content-type':'text/javascript'});response.end(bundle); }
  else { response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const screenshots = path.resolve(repo,process.argv[3] ?? 'tmp/component-parity');
await mkdir(screenshots,{recursive:true});
const browser = await launchChromium();
async function saveImage(page,name) {
  const bytes=await page.screenshot({path:path.join(screenshots,name),fullPage:true});
  evidenceFiles.push({name,sha256:createHash('sha256').update(bytes).digest('hex'),mediaType:'image/png',base64:bytes.toString('base64')});
}
try {
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  async function mount(html,theme='light',viewport={width:800,height:600}) {
    await page.setViewportSize(viewport);
    await page.goto(origin);
    await page.setContent(`<!doctype html><html data-af-dark="${theme==='dark'}"><head><style>html{color-scheme:${theme};font-family:Arial,sans-serif;background:var(--background);color:var(--foreground)}body{padding:24px;margin:0}.gallery{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}.gallery>af-textarea{max-width:100%}af-progress{margin-block:16px}html{--background:#fff;--foreground:#18181b;--muted:#f4f4f5;--muted-foreground:#71717a;--primary:#2563eb;--primary-foreground:#fff;--ring:#2563eb;--input:#d4d4d8;--border:#d4d4d8;--secondary:#f4f4f5;--secondary-foreground:#18181b;--accent:#f4f4f5;--accent-foreground:#18181b}html[data-af-dark=true]{--background:#18181b;--foreground:#fafafa;--muted:#27272a;--muted-foreground:#a1a1aa;--primary:#60a5fa;--primary-foreground:#18181b;--ring:#93c5fd;--input:#52525b;--border:#52525b;--secondary:#27272a;--secondary-foreground:#fafafa;--accent:#27272a;--accent-foreground:#fafafa}</style></head><body>${html}<script type="module" src="/components.js"></script></body></html>`);
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
  for (const theme of ['light','dark']) for (const viewport of [{width:800,height:600},{width:390,height:844}]) {
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
    // Assert the settled CSS state, not an intermediate frame of the focus/selection transition.
    const expectedColor=theme==='dark'?'rgb(96, 165, 250)':'rgb(37, 99, 235)';
    await page.waitForFunction(expected=>{const tab=document.querySelector('af-tabs-trigger[data-state=active]');return tab && getComputedStyle(tab).backgroundColor===expected;},expectedColor,{timeout:2000});
    await saveImage(page,`candidate-tabs-${theme}-${viewport.width}.png`);
    check(await page.getByRole('tab',{name:'Two',exact:true}).evaluate((node,expected)=>getComputedStyle(node).backgroundColor===expected,theme==='dark'?'rgb(96, 165, 250)':'rgb(37, 99, 235)'),`candidate selected theme token ${theme} ${viewport.width}px`);
    check(await page.evaluate(()=>[...document.querySelectorAll('[aria-controls],[aria-labelledby]')].every(node=>['aria-controls','aria-labelledby'].every(attr=>(node.getAttribute(attr)??'').split(/\s+/).filter(Boolean).every(id=>document.getElementById(id))))),`candidate ID references resolve ${theme} ${viewport.width}px`);
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`candidate no horizontal overflow ${theme} ${viewport.width}px`);
    check(await page.getByRole('tab',{name:'Two',exact:true}).evaluate(node=>{const style=getComputedStyle(node);return style.outlineStyle!=='none' && parseFloat(style.outlineWidth)>0;}),`candidate keyboard focus visible ${theme} ${viewport.width}px`);
  }
  const focused = locator=>locator.evaluate(node=>node===document.activeElement);
  async function visibleFocus(locator,label) {
    await page.waitForFunction(selector=>{const node=document.querySelector(selector);if(!node)return false;const style=getComputedStyle(node);return node.matches(':focus-visible') && (style.outlineStyle!=='none' && parseFloat(style.outlineWidth)>0 || /0px 0px 0px [2-9](?:\.\d+)?px/.test(style.boxShadow));},await locator.evaluate(node=>{document.querySelectorAll('[data-focus-probe]').forEach(previous=>previous.removeAttribute('data-focus-probe'));node.dataset.focusProbe='yes';return '[data-focus-probe=yes]';}),{timeout:2000});
    check(await focused(locator),label);
  }
  async function readable(selector,label) {
    const colors=await page.locator(selector).first().evaluate(node=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const context=canvas.getContext('2d');
      const ancestors=[];for(let parent=node;parent;parent=parent.parentElement)ancestors.unshift(parent);
      context.fillStyle='#fff';context.fillRect(0,0,1,1);
      for(const ancestor of ancestors){context.fillStyle=getComputedStyle(ancestor).backgroundColor;context.fillRect(0,0,1,1);}
      const background=[...context.getImageData(0,0,1,1).data].slice(0,3);
      context.fillStyle=getComputedStyle(node).color;context.fillRect(0,0,1,1);
      return {background,foreground:[...context.getImageData(0,0,1,1).data].slice(0,3)};
    });
    const ratio=contrastRatio(colors.background,colors.foreground);
    check(ratio>=4.5,`${label} text contrast ${ratio.toFixed(2)}:1`);
  }
  async function paintContrast(first,second,label) {
    const pixels=await page.evaluate(selectors=>selectors.map(selector=>{
      const node=document.querySelector(selector),canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const context=canvas.getContext('2d'),ancestors=[];for(let parent=node;parent;parent=parent.parentElement)ancestors.unshift(parent);
      context.fillStyle='#fff';context.fillRect(0,0,1,1);
      for(const ancestor of ancestors){context.fillStyle=getComputedStyle(ancestor).backgroundColor;context.fillRect(0,0,1,1);}
      return [...context.getImageData(0,0,1,1).data].slice(0,3);
    }),[first,second]);
    const ratio=contrastRatio(pixels[0],pixels[1]);check(ratio>=3,`${label} nontext contrast ${ratio.toFixed(2)}:1`);
  }
  for (const theme of ['light','dark']) for (const viewport of [{width:800,height:600},{width:390,height:844}]) {
    for(const fixture of componentBrowserFixtures) await section(`${fixture.family} candidate ${theme} ${viewport.width}px`,async()=>{
      await mount(fixture.html,theme,viewport);
      await page.evaluate(()=>document.addEventListener('af-change',event=>{document.body.dataset.intent=JSON.stringify(event.detail);document.body.dataset.intentCount=String(Number(document.body.dataset.intentCount??0)+1);}));
      const tag=`${fixture.family} ${theme} ${viewport.width}px`;
      try {
        if(fixture.family==='button') {
          await page.evaluate(()=>{document.querySelector('#form').addEventListener('submit',event=>{event.preventDefault();document.body.dataset.submits=String(Number(document.body.dataset.submits??0)+1);});document.querySelector('#action').addEventListener('click',()=>{document.body.dataset.clicks=String(Number(document.body.dataset.clicks??0)+1);});});
          const action=page.getByRole('button',{name:'Run action',exact:true});
          await page.locator('#before').focus();await page.keyboard.press('Tab');
          await visibleFocus(action,`${tag} keyboard focus enters native button`);
          await page.keyboard.press('Enter');await page.keyboard.press('Space');
          check(await page.locator('body').getAttribute('data-clicks')==='2',`${tag} Enter/Space each activate once`);
          check(await page.getByRole('button',{name:'Disabled action',exact:true}).isDisabled() && await page.getByRole('button',{name:'Busy action',exact:true}).isDisabled(),`${tag} disabled and busy native semantics`);
          await page.keyboard.press('Tab');check(await focused(page.getByRole('button',{name:'Outline',exact:true})),`${tag} Tab skips disabled/busy`);
          await page.getByRole('button',{name:'Submit form',exact:true}).click();check(await page.locator('body').getAttribute('data-submits')==='1',`${tag} native submit reaches form`);
          await page.mouse.move(0,0);await readable('#action button',tag);await readable('af-button[variant=outline] button',`${tag} outline`);
        } else if(fixture.family==='switch') {
          const control=page.getByRole('switch',{name:'Notifications',exact:true});
          await page.locator('#before').focus();await page.keyboard.press('Tab');await visibleFocus(control,`${tag} switch keyboard focus`);
          await page.keyboard.press('Space');check(await control.getAttribute('aria-checked')==='true',`${tag} Space checks`);
          await page.keyboard.press('Enter');check(await control.getAttribute('aria-checked')==='false',`${tag} Enter unchecks`);
          check(await page.getByRole('switch',{name:'Disabled notifications',exact:true}).isDisabled(),`${tag} disabled native semantics`);
          await page.keyboard.press('Tab');const readonly=page.getByRole('switch',{name:'Read only notifications',exact:true});
          check(await focused(readonly),`${tag} Tab skips disabled`);await page.keyboard.press('Space');check(await readonly.getAttribute('aria-checked')==='false',`${tag} read only does not toggle`);
          await control.click();await readable('af-switch .af-switch-label',tag);
          await page.evaluate(async()=>{await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished));});
          await paintContrast('af-switch .af-switch-button','af-switch .af-switch-thumb',tag);
        } else if(fixture.family==='progress') {
          const progress=page.getByRole('progressbar',{name:'Upload',exact:true});
          check(await progress.getAttribute('aria-valuenow')==='42' && await progress.getAttribute('aria-valuemin')==='0' && await progress.getAttribute('aria-valuemax')==='100',`${tag} labeled numeric range`);
          check(await page.getByRole('progressbar',{name:'Pending',exact:true}).getAttribute('aria-valuenow')===null,`${tag} indeterminate omits numeric value`);
          await progress.evaluate(node=>{node.value=75;});check(await progress.getAttribute('aria-valuenow')==='75',`${tag} property updates semantics`);
          check(await progress.evaluate(node=>node.tabIndex<0),`${tag} noninteractive indicator does not enter Tab order`);
          await paintContrast('af-progress [data-slot=progress-indicator]','af-progress',tag);
        } else if(fixture.family==='collapsible') {
          const trigger=page.getByRole('button',{name:'Show details',exact:true});
          check(await trigger.getAttribute('aria-expanded')==='false' && await page.locator('af-collapsible-content').first().isHidden(),`${tag} starts collapsed`);
          await page.locator('#before').focus();await page.keyboard.press('Tab');await visibleFocus(trigger,`${tag} trigger keyboard focus`);
          await page.keyboard.press('Enter');check(await trigger.getAttribute('aria-expanded')==='true',`${tag} Enter expands`);
          await page.getByLabel('Retained detail').fill('Edited detail');await trigger.focus();await page.keyboard.press('Space');
          check(await page.locator('af-collapsible-content').first().isHidden(),`${tag} Space collapses`);
          await page.keyboard.press('Space');check(await page.getByLabel('Retained detail').inputValue()==='Edited detail',`${tag} preserves authored input`);
          check(await page.getByRole('button',{name:'Disabled details',exact:true}).getAttribute('tabindex')==='-1',`${tag} disabled trigger excluded from Tab order`);
          await page.getByRole('button',{name:'Disabled details',exact:true}).evaluate(node=>node.click());
          check(await page.locator('af-collapsible-content').nth(1).isHidden(),`${tag} disabled trigger cannot open`);await readable('af-collapsible-trigger',tag);
        } else if(fixture.family==='dialog') {
          const trigger=page.getByRole('button',{name:'Open settings',exact:true});
          await page.getByRole('button',{name:'Disabled dialog',exact:true}).evaluate(node=>node.click());check(await page.getByRole('dialog').count()===0,`${tag} disabled opener cannot open`);
          await page.locator('#before').focus();await page.keyboard.press('Tab');await visibleFocus(trigger,`${tag} opener keyboard focus`);await page.keyboard.press('Enter');
          const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
          check(await dialog.isVisible() && await dialog.getAttribute('aria-describedby')!==null,`${tag} native modal has title and description`);
          check(await dialog.evaluate(node=>node.contains(document.activeElement)),`${tag} opening moves focus inside`);
          await page.getByRole('button',{name:'Close settings',exact:true}).focus();await page.keyboard.press('Tab');check(await dialog.evaluate(node=>node.contains(document.activeElement)),`${tag} Tab stays in modal`);
          await page.keyboard.press('Escape');check(await page.getByRole('dialog').count()===0 && await focused(trigger),`${tag} Escape closes and restores focus`);
          await page.keyboard.press('Space');await page.getByRole('button',{name:'Close settings',exact:true}).click();check(await page.getByRole('dialog').count()===0 && await focused(trigger),`${tag} close control restores focus`);
          await page.keyboard.press('Enter');await readable('dialog',tag);
          const bounds=await page.getByRole('dialog',{name:'Settings',exact:true}).boundingBox();check(bounds && bounds.x>=0 && bounds.x+bounds.width<=viewport.width,`${tag} modal fits viewport`);
        } else if(fixture.family==='slider') {
          const slider=page.getByRole('slider',{name:'Volume',exact:true});
          await page.locator('#before').focus();await page.keyboard.press('Tab');await visibleFocus(slider,`${tag} native slider keyboard focus`);
          await page.keyboard.press('ArrowRight');check(await slider.inputValue()==='30',`${tag} ArrowRight follows step`);
          await page.keyboard.press('End');check(await slider.inputValue()==='100',`${tag} End reaches maximum`);
          await page.keyboard.press('Home');check(await slider.inputValue()==='0',`${tag} Home reaches minimum`);
          check(await page.getByRole('slider',{name:'Disabled volume',exact:true}).isDisabled(),`${tag} disabled native semantics`);
          await page.keyboard.press('Tab');const readonly=page.getByRole('slider',{name:'Read only volume',exact:true});check(await focused(readonly),`${tag} Tab skips disabled slider`);
          await page.keyboard.press('ArrowRight');check(await readonly.inputValue()==='25',`${tag} read only restores range`);await readable('af-slider label',tag);
        } else if(fixture.family==='text-controls') {
          const input=page.getByRole('textbox',{name:'Name',exact:true});
          await page.locator('#before').focus();await page.keyboard.press('Tab');await visibleFocus(input,`${tag} labeled native input keyboard focus`);
          await input.fill('Edited name');check(await input.inputValue()==='Edited name',`${tag} accepts text`);
          const number=page.getByRole('spinbutton',{name:'Quantity',exact:true});await number.fill('4');check(await page.locator('body').getAttribute('data-intent')==='{"value":4}',`${tag} number emits numeric intent`);
          await number.focus();await page.keyboard.press('Tab');const readonly=page.getByRole('textbox',{name:'Read only name',exact:true});check(await focused(readonly),`${tag} Tab skips disabled input`);
          await page.keyboard.type('cannot edit');check(await readonly.inputValue()==='Fixed',`${tag} native read only preserves value`);
          check(await page.getByRole('textbox',{name:'Disabled name',exact:true}).isDisabled(),`${tag} disabled native input semantics`);
          await page.keyboard.press('Tab');const notes=page.getByRole('textbox',{name:'Notes',exact:true});await visibleFocus(notes,`${tag} textarea keyboard focus`);
          await notes.fill('First line\nSecond line');check(await notes.inputValue()==='First line\nSecond line',`${tag} textarea retains multiline input`);await readable('af-input input',tag);await readable('af-textarea textarea',`${tag} textarea`);
          check(await page.getByRole('textbox',{name:'Disabled notes',exact:true}).isDisabled(),`${tag} disabled native textarea semantics`);
          await page.keyboard.press('Tab');const readonlyNotes=page.getByRole('textbox',{name:'Read only notes',exact:true});check(await focused(readonlyNotes),`${tag} Tab skips disabled textarea`);
          await page.keyboard.type('cannot edit');check(await readonlyNotes.inputValue()==='Fixed notes',`${tag} native read only textarea preserves value`);
        }
        check(await page.evaluate(()=>[...document.querySelectorAll('[aria-controls],[aria-labelledby],[aria-describedby]')].every(node=>['aria-controls','aria-labelledby','aria-describedby'].every(attr=>(node.getAttribute(attr)??'').split(/\s+/).filter(Boolean).every(id=>document.getElementById(id))))),`${tag} references resolve`);
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${tag} no horizontal overflow`);
      } finally {
        // Settle finite transitions while leaving the indeterminate progress animation deterministic.
        await page.evaluate(async()=>{await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished));for(const animation of document.getAnimations())if(animation.effect?.getTiming().iterations===Infinity){animation.pause();animation.currentTime=0;}});
        await saveImage(page,`candidate-${fixture.family}-${theme}-${viewport.width}.png`);
      }
    });
  }

  check(errors.length===0,`candidate has no page errors (${errors.join('; ') || 'none'})`);
  const evidence=JSON.stringify({candidateBundleSha256:createHash('sha256').update(bundle).digest('hex'),reference:{kind:'recorded-react-ssr',sha256:oracleHash,fixtures:tabsParityFixtures().map(fixture=>({id:fixture.id,oldJsx:fixture.oldJsx,newHtml:fixture.newHtml}))},families:componentBrowserFixtures.map(fixture=>({family:fixture.family,evidence:fixture.evidence})),viewports:[800,390],screenshots:'candidate-only; old-browser visual comparison not yet captured',themes:'fixture token pairs, not every product design system'},null,2);
  await writeFile(path.join(screenshots,'evidence.json'),evidence);
  evidenceFiles.push({name:'evidence.json',mediaType:'application/json',base64:Buffer.from(evidence).toString('base64')});
  check.note(`Candidate review images: ${screenshots}; no old-browser screenshot comparison claimed`);
} finally {
  // Container --rm removes its filesystem. Preserve synthetic review files in captured stdout too.
  const run=JSON.stringify({candidateBundleSha256:createHash('sha256').update(bundle).digest('hex'),recordedReactSsrSha256:oracleHash,browser:browser.version(),viewports:[800,390],themes:['light','dark'],failures:check.failures,screenshotComparison:'candidate-only; old-browser visual baseline pending'});
  evidenceFiles.push({name:'run.json',mediaType:'application/json',base64:Buffer.from(run).toString('base64')});
  const archive=gzipSync(Buffer.from(JSON.stringify({format:'component-parity-files-v1',files:evidenceFiles})));
  console.log(`COMPONENT_PARITY_EVIDENCE_GZIP_BASE64 ${archive.toString('base64')}`);
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
check.done();
