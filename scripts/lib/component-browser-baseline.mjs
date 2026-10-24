/** Actual reader capture only: caller mounts a freshly published real reader URL.
 * No page.setContent, hand-rendered JSX, CSS surrogate or production writes. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { browserParityFixtures, parityThemes, parityViewports } from '../fixtures/component-baseline/index.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Serializable behavior and geometry; generated IDs/classes intentionally excluded. */
function browserState() {
  const visible = node => !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const name = node => node.getAttribute('aria-label') || (node.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>document.getElementById(id)?.textContent || '').join(' ').trim() || node.textContent?.replace(/\s+/g,' ').trim() || '';
  return {
    text: document.body.innerText.replace(/\s+/g,' ').trim(),
    controls: [...document.querySelectorAll('button,input,select,textarea,[role="tab"],[role="dialog"],[role="option"],[role="listbox"]')].filter(visible).map(node=>({role:node.getAttribute('role') || ({BUTTON:'button',INPUT:'textbox',SELECT:'combobox',TEXTAREA:'textbox'})[node.tagName],name:name(node),disabled:node.matches(':disabled') || node.getAttribute('aria-disabled')==='true',selected:node.getAttribute('aria-selected'),expanded:node.getAttribute('aria-expanded'),focused:document.activeElement===node,value:'value' in node?node.value:undefined})),
    rows:[...document.querySelectorAll('tr')].filter(visible).map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.textContent?.trim())),
    overflow:document.documentElement.scrollWidth-innerWidth,
  };
}

/** mount({fixture,theme,viewport,page}) returns {frame,ready?}; must navigate to
 * a real local reader. Source revisions are supplied independently, never inferred. */
export async function captureBrowserBaseline({browser,mount,implementation,sourceRevision,output,fixtures=browserParityFixtures}) {
  if (!['jsx','html'].includes(implementation) || !/^[a-f0-9]{40}$/.test(sourceRevision)) throw Error('Explicit implementation and full source revision required');
  await mkdir(output,{recursive:true});
  /** @type {import('../fixtures/component-baseline/contract').BrowserParityCapture[]} */
  const captures=[];
  for (const fixture of fixtures) for (const theme of parityThemes) for (const viewport of parityViewports) for (const state of fixture.states) {
    const context=await browser.newContext({viewport,colorScheme:theme,reducedMotion:'reduce',locale:'en-US',timezoneId:'UTC'});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    try {
      const {frame,ready}=await mount({fixture,theme,viewport,page});
      const url=new URL(frame.url());
      if (!['127.0.0.1','localhost','app.lvh.me','lvh.me'].includes(url.hostname) && !url.hostname.endsWith('.lvh.me')) throw Error('Browser baseline must use an isolated local reader');
      await ready?.();
      await frame.evaluate(()=>document.fonts.ready);
      for(const action of state.actions) {
        const target=frame.getByRole(action.role,{...(action.name?{name:action.name,exact:true}:{})});
        if(action.action==='press') await target.press(action.key); else await target[action.action]();
      }
      await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const semantics=await frame.evaluate(browserState);
      const name=`${fixture.id}-${theme}-${viewport.width}-${state.id}-${implementation}.png`;
      // Capture the document viewport itself, excluding platform chrome.
      const screenshot=await frame.locator('html').screenshot({animations:'disabled',caret:'hide'});
      await writeFile(path.join(output,name),screenshot);
      captures.push({fixture:fixture.id,state:state.id,theme,viewport,implementation,sourceRevision,fixtureHash:hash(JSON.stringify(fixture)),screenshot:name,screenshotSha256:hash(screenshot),semantics,errors});
    } finally {await context.close();}
  }
  await writeFile(path.join(output,`${implementation}-captures.json`),JSON.stringify(captures,null,2));
  return captures;
}

/** Produce diagnostic pixel diffs, never label unequal images parity. */
export async function compareBrowserBaselines({baseline,candidate,baselineDirectory,candidateDirectory,output}) {
  await mkdir(output,{recursive:true});
  const key=item=>`${item.fixture}/${item.theme}/${item.viewport.width}x${item.viewport.height}/${item.state}`;
  const candidates=new Map(candidate.map(item=>[key(item),item]));
  const results=[];
  for(const old of baseline) {
    const current=candidates.get(key(old));candidates.delete(key(old));
    if(!current){results.push({key:key(old),error:'Missing candidate capture'});continue;}
    if(old.implementation!=='jsx'||current.implementation!=='html'||old.fixtureHash!==current.fixtureHash){results.push({key:key(old),error:'Unmatched implementation or fixture inputs'});continue;}
    const [a,b]=await Promise.all([readFile(path.join(baselineDirectory,old.screenshot)),readFile(path.join(candidateDirectory,current.screenshot))]);
    if(hash(a)!==old.screenshotSha256||hash(b)!==current.screenshotSha256)throw Error('Capture image hash mismatch');
    const [left,right]=await Promise.all([sharp(a).ensureAlpha().raw().toBuffer({resolveWithObject:true}),sharp(b).ensureAlpha().raw().toBuffer({resolveWithObject:true})]);
    const sizeEqual=left.info.width===right.info.width&&left.info.height===right.info.height;
    let changedPixels=null,diff;
    if(sizeEqual){changedPixels=0;diff=Buffer.alloc(left.data.length);for(let i=0;i<left.data.length;i+=4){const changed=[0,1,2,3].some(channel=>left.data[i+channel]!==right.data[i+channel]);if(changed)changedPixels++;diff[i]=changed?255:Math.round(left.data[i]*.25);diff[i+1]=changed?0:Math.round(left.data[i+1]*.25);diff[i+2]=changed?128:Math.round(left.data[i+2]*.25);diff[i+3]=255;}
      await sharp(diff,{raw:{width:left.info.width,height:left.info.height,channels:4}}).png().toFile(path.join(output,`${key(old).replaceAll('/','-')}-diff.png`));}
    results.push({key:key(old),sizeEqual,changedPixels,changedFraction:changedPixels===null?null:changedPixels/(left.info.width*left.info.height),behaviorEqual:JSON.stringify(old.semantics)===JSON.stringify(current.semantics),baselineErrors:old.errors,candidateErrors:current.errors});
  }
  for(const extra of candidates.keys())results.push({key:extra,error:'Missing original capture'});
  await writeFile(path.join(output,'comparison.json'),JSON.stringify(results,null,2));
  return results;
}
