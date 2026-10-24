/** Targeted compiled-module checks. Recorded React SSR parity; candidate browser contracts and review images. */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { launchChromium } from './lib/browser.mjs';
import { withNativeFileChooser } from './lib/native-file-chooser.mjs';
import { createChecker, createSection } from './lib/assert.mjs';
import { semanticSnapshot, semanticDifferences, tabsParityFixtures, tabsInteractionHtml, tabsInteractionCases, componentBrowserFixtures, contrastRatio, duplicateIdentities } from '../lib/component-parity.mjs';

const check = createChecker('html-components');
const section = createSection(check);
const evidenceFiles = [];
const families=['Tabs','Button','Switch','Progress','Collapsible','Dialog','Slider','Input','Textarea','Accordion','Select','DatePicker','Segmented','Avatar','Icon','FileUpload','SlideDeck'];
const sourceName=family=>family.replace(/[A-Z]/g,(letter,index)=>(index?'-':'')+letter.toLowerCase());
const repo = path.resolve(import.meta.dirname,'../..');
// These bytes are the real retained React capture, not a new expected DOM manufactured by this gate.
const oracleBytes = await readFile(path.join(repo,'services/app/lib/islands/__tests__/fixtures/react-oracle.json'));
const oracleHash = createHash('sha256').update(oracleBytes).digest('hex');
if (oracleHash !== 'fc56abeba44af903e616ed3172d5dddaad44c5c7b1afbc10ecf92078e10d468b') throw new Error('Recorded React reference changed: review and explicitly repin the capture');
const oracle = JSON.parse(oracleBytes);
const result = await build({stdin:{contents:families.map(family=>`import {register${family}} from './services/app/lib/html-components/${sourceName(family)}.ts';register${family}();`).join('')+"document.documentElement.dataset.fixtureReady='yes';",resolveDir:repo,sourcefile:'components-gate.ts'},bundle:true,format:'esm',platform:'browser',write:false});
const bundle = result.outputFiles[0].contents;
const server = createServer((request,response) => {
  if(request.url==='/avatar.svg'){response.writeHead(200,{'content-type':'image/svg+xml'});response.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2563eb"/><circle cx="16" cy="16" r="8" fill="white"/></svg>');return;}
  if(request.url==='/missing-avatar.svg'){response.writeHead(404);response.end('Fixture image unavailable');return;}
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
  const errors=[],requests=[];
  function configurePage(candidate) {
    candidate.setDefaultTimeout(2500);candidate.setDefaultNavigationTimeout(5000);
    candidate.on('request',request=>requests.push(request.url()));candidate.on('pageerror',error=>errors.push(error.message));
    return candidate;
  }
  let page = configurePage(await browser.newPage());
  async function mount(html,theme='light',viewport={width:800,height:600},setup='') {
    await page.setViewportSize(viewport);
    await page.goto(origin);
    await page.setContent(`<!doctype html><html data-af-dark="${theme==='dark'}"><head><style>html{color-scheme:${theme};font-family:Arial,sans-serif;background:var(--background);color:var(--foreground)}body{padding:24px;margin:0}.gallery{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}.gallery>af-textarea{max-width:100%}af-progress{margin-block:16px}html{--background:#fff;--foreground:#18181b;--muted:#f4f4f5;--muted-foreground:#686873;--primary:#2563eb;--primary-foreground:#fff;--ring:#2563eb;--input:#d4d4d8;--border:#d4d4d8;--secondary:#f4f4f5;--secondary-foreground:#18181b;--accent:#f4f4f5;--accent-foreground:#18181b}html[data-af-dark=true]{--background:#18181b;--foreground:#fafafa;--muted:#27272a;--muted-foreground:#a1a1aa;--primary:#60a5fa;--primary-foreground:#18181b;--ring:#93c5fd;--input:#52525b;--border:#52525b;--secondary:#27272a;--secondary-foreground:#fafafa;--accent:#27272a;--accent-foreground:#fafafa}</style></head><body>${html}<script>${setup}</script><script type="module" src="/components.js"></script></body></html>`);
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
  const settleTransitions=()=>page.evaluate(async()=>{await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished));});
  async function popupFits(popup,trigger,label) {
    const bounds=await popup.boundingBox(),anchor=await trigger.boundingBox(),viewport=page.viewportSize();
    check(bounds && anchor && bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=viewport.width+1 && bounds.y+bounds.height<=anchor.y+1,label);
  }
  async function waitDeck(index,selector='af-slide-deck') {
    await page.waitForFunction(({index,selector})=>{const deck=document.querySelector(selector),slide=deck&&[...deck.querySelectorAll('af-slide')].filter(slide=>slide.closest('af-slide-deck')===deck)[index];if(!slide||deck.index!==index)return false;const target=Math.min(Math.max(0,scrollY+slide.getBoundingClientRect().top),Math.max(0,document.scrollingElement.scrollHeight-innerHeight));return Math.abs(scrollY-target)<2;},{index,selector},{timeout:2500});
  }
  const nativeState=()=>page.evaluate(()=>JSON.stringify([...document.querySelectorAll('input,textarea,select,button')].map(node=>({tag:node.localName,value:node.value,checked:node.checked,disabled:node.disabled,pressed:node.getAttribute('aria-pressed'),expanded:node.getAttribute('aria-expanded')}))));
  async function themeFlip(theme,label,subject) {
    const paint=()=>page.locator(subject).first().evaluate(root=>{const node=[...root.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[data-slot=progress-indicator],h1')].find(node=>node.getClientRects().length)??root;const style=getComputedStyle(node);return JSON.stringify({color:style.color,background:style.backgroundColor,border:style.borderColor,accent:style.accentColor});});
    const before=await nativeState(),paintBefore=await paint(),opposite=theme==='dark'?'light':'dark';
    await page.evaluate(theme=>{document.documentElement.dataset.afDark=String(theme==='dark');document.documentElement.style.colorScheme=theme;},opposite);
    await page.waitForFunction(color=>getComputedStyle(document.documentElement).backgroundColor===color,opposite==='dark'?'rgb(24, 24, 27)':'rgb(255, 255, 255)',{timeout:2000});await settleTransitions();
    check(await nativeState()===before,`${label} live theme flip preserves control state`);
    check(await paint()!==paintBefore,`${label} live theme flip repaints representative control`);
    await page.evaluate(theme=>{document.documentElement.dataset.afDark=String(theme==='dark');document.documentElement.style.colorScheme=theme;},theme);await settleTransitions();
  }
  for (const theme of ['light','dark']) for (const viewport of [{width:800,height:600},{width:390,height:844}]) {
    for(const fixture of componentBrowserFixtures) await section(`${fixture.family} candidate ${theme} ${viewport.width}px`,async()=>{
      const sharedPage=page;
      // Native chooser interception belongs to a fresh WebContents/context, rather than a
      // page repeatedly navigated through modal/fullscreen cases. Still use real Enter activation.
      const chooserContext=fixture.family==='file-upload'?await browser.newContext():null;
      const tag=`${fixture.family} ${theme} ${viewport.width}px`;
      try {
        if(chooserContext)page=configurePage(await chooserContext.newPage());
        await mount(fixture.html,theme,viewport,fixture.setup);
        await page.evaluate(()=>document.addEventListener('af-change',event=>{document.body.dataset.intent=JSON.stringify(event.detail);document.body.dataset.intentCount=String(Number(document.body.dataset.intentCount??0)+1);}));
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
          // Preserve the retained kit's explicit edge loop; native modal inertness alone is a different contract.
          const first=page.getByLabel('Display name',{exact:true}),last=page.getByRole('button',{name:'Close settings',exact:true});
          const focusDescription=()=>page.evaluate(()=>{const node=document.activeElement;return JSON.stringify({tag:node?.localName,id:node?.id,role:node?.getAttribute('role'),name:node?.getAttribute('aria-label'),documentFocused:document.hasFocus()});});
          await last.focus();await page.keyboard.press('Tab');
          check(await focused(first),`${tag} Tab wraps last to first (${await focusDescription()})`);
          await first.focus();await page.keyboard.press('Shift+Tab');
          check(await focused(last),`${tag} Shift+Tab wraps first to last (${await focusDescription()})`);
          await first.focus();
          await page.locator('#before').evaluate(node=>node.focus());
          check(await dialog.evaluate(node=>node.contains(document.activeElement)),`${tag} modal blocks programmatic background focus (${await focusDescription()})`);
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
        } else if(fixture.family==='accordion') {
          const first=page.getByRole('button',{name:'First section',exact:true}),third=page.getByRole('button',{name:'Third section',exact:true});
          await page.locator('#before').focus();await page.keyboard.press('Tab');await visibleFocus(first,`${tag} trigger keyboard focus`);
          await page.getByLabel('Retained accordion input').fill('Edited section');await first.focus();await page.keyboard.press('Space');check(await first.getAttribute('aria-expanded')==='false',`${tag} Space collapses`);
          await page.keyboard.press('Enter');check(await first.getAttribute('aria-expanded')==='true',`${tag} Enter expands`);
          await page.keyboard.press('ArrowDown');check(await focused(third),`${tag} ArrowDown skips disabled item`);await page.keyboard.press('Enter');check(await third.getAttribute('aria-expanded')==='true' && await first.getAttribute('aria-expanded')==='false',`${tag} single selection closes prior panel`);
          await page.keyboard.press('Home');check(await focused(first),`${tag} Home focuses first`);await page.keyboard.press('Enter');check(await page.getByLabel('Retained accordion input').inputValue()==='Edited section',`${tag} mounted panel preserves input`);
          await page.getByRole('button',{name:'Multiple A',exact:true}).click();await page.getByRole('button',{name:'Multiple B',exact:true}).click();check(await page.getByRole('button',{name:'Multiple A',exact:true}).getAttribute('aria-expanded')==='true' && await page.getByRole('button',{name:'Multiple B',exact:true}).getAttribute('aria-expanded')==='true',`${tag} multiple mode keeps both panels open`);
          check(await page.getByRole('button',{name:'Unavailable section',exact:true}).getAttribute('aria-disabled')==='true',`${tag} disabled semantics`);await readable('af-accordion-trigger',tag);
        } else if(fixture.family==='select') {
          const single=page.locator('#single-picker'),trigger=single.getByRole('button',{name:'Color',exact:true});
          await page.locator('#before').focus();await page.keyboard.press('Tab');await visibleFocus(trigger,`${tag} picker keyboard focus`);await page.keyboard.press('ArrowDown');
          const search=single.getByRole('searchbox');check(await focused(search),`${tag} opening focuses filter`);await search.fill('Blue');await page.keyboard.press('Enter');check(await single.evaluate(node=>node.value)==='blue' && await focused(trigger),`${tag} filtered Enter selects typed value and restores focus`);
          const multi=page.locator('#multiple-picker');await multi.getByRole('button',{name:'Tags',exact:true}).click();await multi.getByRole('searchbox').fill('New');await page.keyboard.press('Enter');check(await multi.evaluate(node=>JSON.stringify(node.value))==='[]',`${tag} multiple selection remains draft`);
          await multi.getByRole('button',{name:'Done',exact:true}).click();check(await multi.evaluate(node=>JSON.stringify(node.value))==='["New"]',`${tag} Done commits created tag`);
          await multi.getByRole('button',{name:'Tags',exact:true}).click();await multi.getByRole('option',{name:'Red',exact:true}).click();await page.keyboard.press('Escape');check(await multi.evaluate(node=>JSON.stringify(node.value))==='["New"]',`${tag} Escape discards draft`);
          check(await page.getByRole('button',{name:'Disabled picker',exact:true}).isDisabled(),`${tag} disabled picker semantics`);
          await single.evaluate(node=>{node.style.cssText='position:fixed;right:8px;bottom:8px';});await trigger.click();await popupFits(single.locator('[data-popup]'),trigger,`${tag} corner popup flips above`);await readable('#single-picker [data-popup]',tag);
        } else if(fixture.family==='date-picker') {
          const picker=page.locator('af-date-picker').first();await picker.evaluate(node=>{node.clock=()=>new Date(2024,0,15,12);});
          let trigger=picker.locator('.af-date-trigger');await page.locator('#before').focus();await page.keyboard.press('Tab');await visibleFocus(trigger,`${tag} date trigger keyboard focus`);await page.keyboard.press('ArrowDown');
          check(await picker.locator('[data-date="2024-01-15"]').evaluate(node=>node===document.activeElement),`${tag} opens on selected date`);
          await page.keyboard.press('ArrowRight');check(await picker.locator('[data-date="2024-01-16"]').evaluate(node=>node===document.activeElement),`${tag} ArrowRight moves one date`);await page.keyboard.press('Enter');check(await picker.evaluate(node=>node.value)==='2024-01-16' && await focused(trigger),`${tag} Enter chooses and restores trigger`);
          await page.keyboard.press('ArrowDown');await page.keyboard.press('PageDown');check(await picker.locator('[data-date="2024-02-16"]').evaluate(node=>node===document.activeElement),`${tag} PageDown keeps day next month`);await page.keyboard.press('Enter');check(await picker.evaluate(node=>node.value)==='2024-02-16',`${tag} month navigation commits date`);
          await trigger.click();await picker.getByRole('button',{name:'Today',exact:true}).click();check(await picker.evaluate(node=>node.value)==='2024-01-15',`${tag} injected local Today is deterministic`);
          await trigger.click();check(await picker.locator('[data-date="2024-01-09"]').isDisabled(),`${tag} minimum disables out of range date`);await picker.getByRole('button',{name:'Clear date',exact:true}).click();check(await picker.evaluate(node=>node.value)===null,`${tag} Clear emits null`);
          check(await page.locator('af-date-picker[disabled] button').isDisabled(),`${tag} disabled native date trigger`);const readonly=page.locator('af-date-picker[readonly] .af-date-trigger');await readonly.focus();await page.keyboard.press('ArrowDown');check(await readonly.getAttribute('aria-expanded')==='false',`${tag} read only cannot open`);
          await picker.evaluate(node=>{node.style.cssText='position:fixed;right:8px;bottom:8px';});await trigger.click();await popupFits(picker.getByRole('dialog'),trigger,`${tag} corner calendar flips above`);await readable('af-date-picker .af-date-popup',tag);
        } else if(fixture.family==='segmented') {
          const group=page.getByRole('group',{name:'Period',exact:true}),one=group.getByRole('button',{name:'One',exact:true}),two=group.getByRole('button',{name:'Two',exact:true});
          await page.locator('#before').focus();await page.keyboard.press('Tab');await visibleFocus(one,`${tag} roving keyboard entry`);await page.keyboard.press('ArrowRight');check(await focused(two) && await group.evaluate(node=>node.value)===2,`${tag} ArrowRight selects numeric value`);
          await page.keyboard.press('End');check(await group.evaluate(node=>node.value)===3,`${tag} End selects final option`);await page.keyboard.press('Home');check(await group.evaluate(node=>node.value)===1,`${tag} Home selects first option`);
          await group.evaluate(node=>node.setAttribute('dir','rtl'));await page.keyboard.press('ArrowLeft');check(await group.evaluate(node=>node.value)===2,`${tag} RTL ArrowLeft advances`);
          await group.evaluate(node=>{node.orientation='vertical';});await page.keyboard.press('ArrowDown');check(await group.evaluate(node=>node.value)===3,`${tag} vertical ArrowDown advances`);
          check(await page.getByRole('group',{name:'Disabled period',exact:true}).getByRole('button').evaluateAll(nodes=>nodes.every(node=>node.disabled)),`${tag} disabled group native semantics`);await settleTransitions();await readable('af-segmented [aria-pressed=true]',tag);
        } else if(fixture.family==='avatar-icon') {
          await page.waitForFunction(()=>document.querySelector('#portrait').status==='loaded' && document.querySelector('#missing-portrait').status==='error',null,{timeout:2000});
          check(await page.getByRole('img',{name:'Sample portrait',exact:true}).isVisible() && await page.locator('#portrait af-avatar-fallback').isHidden(),`${tag} loaded image replaces fallback`);
          check(await page.locator('#missing-portrait af-avatar-fallback').isVisible() && await page.locator('#missing-portrait af-avatar-fallback').textContent()==='AB',`${tag} failed image shows authored fallback`);
          check(await page.getByRole('img',{name:'Complete',exact:true}).count()===1 && await page.getByRole('img',{name:'Unknown icon',exact:true}).count()===1,`${tag} labeled icons expose names including unknown fallback`);
          check(await page.locator('af-icon:not([label]) svg').getAttribute('aria-hidden')==='true',`${tag} decorative icon hidden from accessibility tree`);await readable('#missing-portrait af-avatar-fallback',tag);
        } else if(fixture.family==='file-upload') {
          const requestMark=requests.length;
          const upload=page.locator('af-file-upload').first();await upload.evaluate(node=>{
            let failed=false;node.adapter={upload:async(file,context)=>{document.body.dataset.uploadCalls=String(Number(document.body.dataset.uploadCalls??0)+1);document.body.dataset.uploadDataset=context.dataset;if(file.name==='retry.txt'&&!failed){failed=true;throw new Error('Fixture upload failed');}if(file.name==='pending.txt')await new Promise(resolve=>node.addEventListener('fixture:release',()=>resolve(),{once:true}));return {ref:`fixture-${file.name}`,name:file.name,contentType:file.type,size:file.size};}};
          });
          const choose=upload.getByRole('button',{name:'Choose Attachments',exact:true});
          // Fullscreen can change native window focus. A native chooser requires the active browser document.
          const documentFocusedBefore=await page.evaluate(()=>document.hasFocus());await page.bringToFront();await page.waitForFunction(()=>document.hasFocus(),null,{timeout:2500});
          await page.locator('#before').focus();await page.keyboard.press('Tab');await visibleFocus(choose,`${tag} chooser keyboard focus`);
          await upload.evaluate((node,before)=>{const button=node.querySelector('button'),input=node.querySelector('input');const details={documentFocusedBefore:before,clicks:[],inputClicks:[]};node.chooserDiagnostics=details;const record=event=>({trusted:event.isTrusted,documentFocused:document.hasFocus(),activation:navigator.userActivation.isActive,inputConnected:input.isConnected,inputDisabled:input.disabled,activeTag:document.activeElement?.localName});button.addEventListener('click',event=>details.clicks.push(record(event)),true);input.addEventListener('click',event=>details.inputClicks.push(record(event)),true);},documentFocusedBefore);
          const chooserProtocol={};
          const chooserDiagnostics=async()=>({...await upload.evaluate(node=>node.chooserDiagnostics),protocol:chooserProtocol});
          try {
            await withNativeFileChooser(page,()=>page.keyboard.press('Enter'),async chooser=>{
              check(chooser.isMultiple() && await chooser.element().evaluate(node=>node===document.querySelector('af-file-upload input[type=file]')),`${tag} native chooser belongs to enabled upload input`);
              await chooser.setFiles({name:'sample.txt',mimeType:'text/plain',buffer:Buffer.from('Sample')});
            },{timeout:2000,diagnostics:chooserProtocol});
          } catch(error){check.note(`${tag} native chooser diagnostics ${JSON.stringify(await chooserDiagnostics())}`);throw error;}
          check.note(`${tag} native chooser diagnostics ${JSON.stringify(await chooserDiagnostics())}`);
          check(chooserProtocol.armed && chooserProtocol.protocolEvents.length===1 && chooserProtocol.playwrightEvents===1,`${tag} one acknowledged native chooser event`);
          await page.waitForFunction(()=>document.querySelector('af-file-upload').value.length===1);check(await upload.getByRole('list',{name:'Attachments files',exact:true}).textContent().then(text=>text.includes('sample.txt')),`${tag} native picker invokes deterministic adapter`);check(await page.locator('body').getAttribute('data-upload-dataset')==='fixture-files',`${tag} adapter receives dataset name`);
          await upload.getByRole('button',{name:'Remove sample.txt',exact:true}).click();check(await upload.evaluate(node=>node.value.length)===0 && await focused(choose),`${tag} removal restores chooser focus`);
          await upload.locator('input[type=file]').setInputFiles({name:'retry.txt',mimeType:'text/plain',buffer:Buffer.from('Retry')});await upload.getByRole('alert').waitFor();check(await upload.getByRole('alert').textContent().then(text=>text.includes('Fixture upload failed')),`${tag} failure is visible`);
          await upload.getByRole('button',{name:'Retry retry.txt',exact:true}).click();await page.waitForFunction(()=>document.querySelector('af-file-upload').value.length===1);check(await upload.getByRole('alert').count()===0,`${tag} retry succeeds`);
          await upload.locator('input[type=file]').setInputFiles({name:'pending.txt',mimeType:'text/plain',buffer:Buffer.from('Pending')});await page.waitForFunction(()=>document.querySelector('af-file-upload').busy);check(await choose.isDisabled() && await upload.getByRole('progressbar',{name:'Uploading files',exact:true}).isVisible(),`${tag} pending adapter disables chooser and exposes progress`);
          await upload.evaluate(node=>node.dispatchEvent(new Event('fixture:release')));await page.waitForFunction(()=>!document.querySelector('af-file-upload').busy);check(await upload.evaluate(node=>node.value.length)===2,`${tag} pending upload commits on deterministic release`);
          const calls=await page.locator('body').getAttribute('data-upload-calls');await upload.locator('input[type=file]').setInputFiles({name:'invalid.bin',mimeType:'application/octet-stream',buffer:Buffer.from('x')});await upload.getByRole('alert').waitFor();check(await page.locator('body').getAttribute('data-upload-calls')===calls,`${tag} rejected file never reaches adapter`);
          check(await page.getByRole('button',{name:'Choose Disabled attachments',exact:true}).isDisabled(),`${tag} disabled chooser semantics`);check(requests.length===requestMark,`${tag} fake uploads issue no HTTP requests`);await readable('af-file-upload button',tag);
        } else if(fixture.family==='slide-deck') {
          const deck=page.locator('af-slide-deck').first(),next=deck.getByRole('button',{name:'Next slide',exact:true});
          const priorViewport=page.viewportSize();await page.setViewportSize({width:390,height:844});
          await deck.locator('af-slide').first().evaluate(node=>{node.scrollIntoView({behavior:'instant',block:'start'});window.dispatchEvent(new Event('scroll'));});await waitDeck(0);
          const mobileSlideGeometry=await deck.evaluate(node=>{const [first,second]=node.querySelectorAll(':scope > af-slide');return {firstHeight:first?.getBoundingClientRect().height??0,secondTop:second?.getBoundingClientRect().top??0,viewport:innerHeight};});
          check(mobileSlideGeometry.firstHeight>=mobileSlideGeometry.viewport-1 && mobileSlideGeometry.secondTop>=mobileSlideGeometry.viewport-1,`${tag} mobile slides fill one viewport before the next authored slide (${JSON.stringify(mobileSlideGeometry)})`);
          if(priorViewport)await page.setViewportSize(priorViewport);
          await page.locator('#before').focus();await page.keyboard.press('Tab');await visibleFocus(deck,`${tag} deck keyboard focus`);check(await deck.getByRole('button',{name:'Previous slide',exact:true}).isEnabled(),`${tag} previous control stays enabled at first slide`);await page.keyboard.press('ArrowRight');await waitDeck(1);check(await deck.locator('[data-af-deck-count]').textContent()==='2 / 2',`${tag} keyboard navigation updates active slide/count`);
          await deck.locator('af-slide').first().evaluate(node=>node.scrollIntoView({behavior:'instant',block:'start'}));await waitDeck(0);check(await deck.locator('nav button[aria-current=true]').getAttribute('aria-controls')==='opening-slide',`${tag} document scrolling updates rail marker`);
          const input=page.getByLabel('Slide input');await input.fill('Edited slide');await input.focus();await page.keyboard.press('ArrowRight');check(await deck.evaluate(node=>node.index)===0,`${tag} text field arrow does not page deck`);
          await next.click();await waitDeck(1);check(await input.inputValue()==='Edited slide' && await deck.locator('af-slide').first().evaluate(node=>!node.hidden),`${tag} slide navigation preserves authored field and mounted slides`);check(await next.isEnabled(),`${tag} next control stays enabled at last slide`);
          const present=deck.getByRole('button',{name:'Present',exact:true});await present.click();await page.waitForFunction(()=>document.fullscreenElement===document.querySelector('af-slide-deck'),null,{timeout:2000});check(await deck.locator(':scope > nav').isHidden(),`${tag} actual fullscreen hides rail`);
          await deck.getByRole('button',{name:'Exit presentation',exact:true}).click();await page.waitForFunction(()=>{const present=document.querySelector('af-slide-deck [aria-label="Present"]');return !document.fullscreenElement && present && !present.disabled;});check(await focused(deck.getByRole('button',{name:'Present',exact:true})),`${tag} fullscreen exit restores control focus (${await page.evaluate(()=>JSON.stringify({activeTag:document.activeElement?.localName,documentFocused:document.hasFocus()}))})`);
          await deck.evaluate(node=>{node.requestFullscreen=()=>Promise.reject(new Error('Fixture denied fullscreen'));});await deck.getByRole('button',{name:'Present',exact:true}).click();await deck.getByRole('status').filter({hasText:'Presentation unavailable'}).waitFor();check(await deck.getByRole('button',{name:'Present',exact:true}).isEnabled(),`${tag} simulated rejection leaves presentation usable`);
          check.note(`${tag} post-fullscreen state ${JSON.stringify(await deck.evaluate(node=>({index:node.index,previousDisabled:node.querySelector('[aria-label="Previous slide"]').disabled,scrollY})))}`);
          // Exiting fullscreen may legitimately scroll the restored control/first slide into view.
          // Establish the authored first slide geometrically before testing nested deck isolation.
          await deck.locator('af-slide').first().evaluate(node=>{node.scrollIntoView({behavior:'instant',block:'start'});window.dispatchEvent(new Event('scroll'));});await waitDeck(0);
          await deck.evaluate(deck=>{const node=document.createElement('af-slide-deck');node.id='other-deck';node.style.setProperty('--af-slide-height','64px');node.innerHTML='<af-slide title="Other first">Other first</af-slide><af-slide title="Other second">Other second</af-slide>';deck.querySelector('af-slide').append(node);node.focus({preventScroll:true});});await page.keyboard.press('ArrowRight');await waitDeck(1,'#other-deck');check(await page.locator('#other-deck').evaluate(node=>node.index)===1 && await deck.evaluate(node=>node.index)===0,`${tag} nested deck keyboard does not page outer deck`);
          await page.locator('#other-deck').evaluate(node=>node.querySelectorAll('af-slide').forEach(slide=>slide.remove()));await page.waitForFunction(()=>document.querySelector('#other-deck').index===-1);check(await page.locator('#other-deck [data-af-deck-count]').textContent()==='0 / 0',`${tag} dynamic empty deck has no selection`);
          await page.locator('#other-deck').evaluate(node=>node.remove());await deck.focus({preventScroll:true});
          await page.emulateMedia({media:'print'});check(await deck.locator(':scope > nav').isHidden() && await deck.locator(':scope > [data-af-deck-chrome=toolbar]').isHidden(),`${tag} print excludes chrome`);check(await deck.locator('af-slide').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).display!=='none' && getComputedStyle(node).breakAfter.match(/page|auto/))),`${tag} print keeps authored slides with page boundaries`);await saveImage(page,`candidate-slide-deck-print-${theme}-${viewport.width}.png`);await page.emulateMedia({media:null});await deck.locator('af-slide').first().evaluate(node=>{node.scrollIntoView({behavior:'instant',block:'start'});window.dispatchEvent(new Event('scroll'));});await waitDeck(0);await readable('af-slide h1',tag);
        }
        check(await page.evaluate(()=>[...document.querySelectorAll('[aria-controls],[aria-labelledby],[aria-describedby]')].every(node=>['aria-controls','aria-labelledby','aria-describedby'].every(attr=>(node.getAttribute(attr)??'').split(/\s+/).filter(Boolean).every(id=>document.getElementById(id))))),`${tag} references resolve`);
        check((await page.evaluate(duplicateIdentities,await page.locator('html').elementHandle())).length===0,`${tag} DOM and annotation identities remain unique`);
        await themeFlip(theme,tag,fixture.subject);
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${tag} no horizontal overflow`);
      } catch(error) {
        // createSection keeps its verdict concise; retain the actionable locator call log here.
        check.note(`${tag} failure details ${String(error?.stack??error).slice(0,6000)}`);
        throw error;
      } finally {
        try {
        if(await page.evaluate(()=>!!document.fullscreenElement))await page.evaluate(()=>document.exitFullscreen());
        await page.emulateMedia({media:null});
        // Settle finite transitions while leaving the indeterminate progress animation deterministic.
        await page.evaluate(async()=>{await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished));for(const animation of document.getAnimations())if(animation.effect?.getTiming().iterations===Infinity){animation.pause();animation.currentTime=0;}});
        await saveImage(page,`candidate-${fixture.family}-${theme}-${viewport.width}.png`);
        } finally {
          page=sharedPage;
          if(chooserContext)await chooserContext.close();
        }
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
