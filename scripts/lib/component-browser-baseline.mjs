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
    controls: [...document.querySelectorAll('button,input,select,textarea,dialog,[role="tab"],[role="dialog"],[role="option"],[role="listbox"]')].filter(visible).map(node=>({role:node.getAttribute('role') || (node.tagName==='INPUT'?({file:'file-input',checkbox:'checkbox',radio:'radio',range:'slider',number:'spinbutton',search:'searchbox'})[node.type]||'textbox':({BUTTON:'button',SELECT:'combobox',TEXTAREA:'textbox',DIALOG:'dialog'})[node.tagName]),name:name(node),disabled:node.matches(':disabled') || node.getAttribute('aria-disabled')==='true',selected:node.getAttribute('aria-selected'),expanded:node.getAttribute('aria-expanded'),focused:document.activeElement===node,value:'value' in node?node.value:undefined})),
    rows:[...document.querySelectorAll('tr')].filter(visible).map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.textContent?.trim())),
    overflow:document.documentElement.scrollWidth-innerWidth,
  };
}

/** mount({fixture,theme,viewport,page}) returns {frame,ready?}; must navigate to
 * a real local reader. Source revisions are supplied independently, never inferred. */
export async function captureBrowserBaseline({browser,mount,implementation,sourceRevision,output,fixtures=browserParityFixtures}) {
  if (!['jsx','html'].includes(implementation) || typeof sourceRevision!=='string' || !sourceRevision) throw Error('Explicit implementation and source identity required');
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
      const screenshot=await page.screenshot({fullPage:false,animations:'disabled',caret:'hide'});
      await writeFile(path.join(output,name),screenshot);
      captures.push({fixture:fixture.id,state:state.id,theme,viewport,screenshotMode:'viewport',implementation,sourceRevision,fixtureHash:hash(JSON.stringify(fixture)),screenshot:name,screenshotSha256:hash(screenshot),semantics,errors});
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
    if(old.implementation!=='jsx'||current.implementation!=='html'||old.fixtureHash!==current.fixtureHash||old.screenshotMode!==current.screenshotMode||!(/^[a-f0-9]{40}$/.test(old.sourceRevision)&&/^[a-f0-9]{40}$/.test(current.sourceRevision))){results.push({key:key(old),error:'Unmatched implementation or fixture inputs'});continue;}
    const [a,b]=await Promise.all([readFile(path.join(baselineDirectory,old.screenshot)),readFile(path.join(candidateDirectory,current.screenshot))]);
    if(hash(a)!==old.screenshotSha256||hash(b)!==current.screenshotSha256)throw Error('Capture image hash mismatch');
    const [left,right]=await Promise.all([sharp(a).ensureAlpha().raw().toBuffer({resolveWithObject:true}),sharp(b).ensureAlpha().raw().toBuffer({resolveWithObject:true})]);
    const sizeEqual=left.info.width===right.info.width&&left.info.height===right.info.height;
    let changedPixels=null,diff;
    if(sizeEqual){changedPixels=0;diff=Buffer.alloc(left.data.length);for(let i=0;i<left.data.length;i+=4){const changed=[0,1,2,3].some(channel=>left.data[i+channel]!==right.data[i+channel]);if(changed)changedPixels++;diff[i]=changed?255:Math.round(left.data[i]*.25);diff[i+1]=changed?0:Math.round(left.data[i+1]*.25);diff[i+2]=changed?128:Math.round(left.data[i+2]*.25);diff[i+3]=255;}
      await sharp(diff,{raw:{width:left.info.width,height:left.info.height,channels:4}}).png().toFile(path.join(output,`${key(old).replaceAll('/','-')}-diff.png`));}
    results.push({key:key(old),sizeEqual,changedPixels,changedFraction:changedPixels===null?null:changedPixels/(left.info.width*left.info.height),rawBehaviorEqual:JSON.stringify(old.semantics)===JSON.stringify(current.semantics),behaviorEqual:JSON.stringify(comparableBehavior(old.semantics))===JSON.stringify(comparableBehavior(current.semantics)),baselineErrors:old.errors,candidateErrors:current.errors});
  }
  for(const extra of candidates.keys())results.push({key:extra,error:'Missing original capture'});
  await writeFile(path.join(output,'comparison.json'),JSON.stringify(results,null,2));
  return results;
}

/** Default CI gate assertions are candidate evidence only, never old/new parity. */
export function candidateCaptureIssues(captures) {
  const issues=[];
  for(const capture of captures) {
    const state=capture.semantics;
    if(capture.errors.length)issues.push(`${capture.fixture}: reader page errors`);
    if(state.overflow>1)issues.push(`${capture.fixture}: horizontal overflow`);
    const includes=text=>state.text.includes(text);
    const required={button:['Continue','Secondary','Outline','Unavailable'],tabs:[capture.state==='second'||capture.state==='arrow-right'?'Second panel':'First panel'],select:['Ada'],'file-upload':['Screenshots'],'data-table':['Ada','Grace','Linus']}[capture.fixture]||[];
    for(const text of required)if(!includes(text))issues.push(`${capture.fixture}/${capture.state}: missing ${text}`);
    if(capture.fixture==='select'&&!state.controls.some(control=>control.name==='Person'&&control.role==='button'))issues.push('select: missing named Person control');
    if(capture.fixture==='dialog'&&capture.state==='open'&&!includes('Review changes'))issues.push('dialog: did not open');
    if(capture.fixture==='dialog'&&capture.state==='escape'&&state.controls.some(control=>control.role==='dialog'))issues.push('dialog: did not close on Escape');
    if(capture.fixture==='data-table'&&state.rows.length!==4)issues.push('data-table: expected header and three rows');
  }
  return issues;
}

/** Raw snapshots stay unchanged. Only empty native button values and layout
 * whitespace between a body composed solely of button labels are incidental. */
export function comparableBehavior(raw) {
  const state=structuredClone(raw);
  if(!Array.isArray(state.controls))return state;
  for(const control of state.controls)if(['button','tab'].includes(control.role)&&control.value==='')delete control.value;
  const labels=state.controls.map(control=>control.name);
  if(state.controls.length&&state.controls.every(control=>control.role==='button')&&typeof state.text==='string'&&state.text.replace(/\s/g,'')===labels.join('').replace(/\s/g,''))state.text=labels.join(' ');
  return state;
}
