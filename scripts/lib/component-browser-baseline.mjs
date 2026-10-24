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
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const name = node => {
    const ids=node.getAttribute('aria-labelledby');
    if(ids){const label=clean(ids.split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' '));if(label)return label;}
    if(node.hasAttribute('aria-label'))return clean(node.getAttribute('aria-label'));
    if(node.tagName==='IMG')return clean(node.getAttribute('alt'));
    if(node.labels?.length)return clean([...node.labels].map(label=>label.textContent).join(' '));
    if(node.tagName==='INPUT'&&['button','submit','reset'].includes(node.type))return clean(node.value||(node.type==='submit'?'Submit':node.type==='reset'?'Reset':''));
    return clean(node.textContent||node.getAttribute('title'));
  };
  return {
    text: document.body.innerText.replace(/\s+/g,' ').trim(),
    controls: [...document.querySelectorAll('button,input,select,textarea,dialog,[role="tab"],[role="dialog"],[role="option"],[role="listbox"],[role="slider"],[role="switch"],[role="checkbox"],[role="radio"],[role="combobox"],[role="button"],[role="textbox"],[role="searchbox"],[role="spinbutton"],[role="progressbar"],[role="img"],[role="tooltip"],svg[aria-label],img[alt]')].filter(visible).map(node=>({role:node.getAttribute('role') || (node.tagName==='INPUT'?({file:'file-input',button:'button',submit:'button',reset:'button',checkbox:'checkbox',radio:'radio',range:'slider',number:'spinbutton',search:'searchbox'})[node.type]||'textbox':({BUTTON:'button',SELECT:'combobox',TEXTAREA:'textbox',DIALOG:'dialog',IMG:'img',svg:'svg'})[node.tagName]),name:name(node),disabled:node.matches(':disabled') || node.getAttribute('aria-disabled')==='true',selected:node.getAttribute('aria-selected'),checked:node.getAttribute('aria-checked')??(node.tagName==='INPUT'&&['checkbox','radio'].includes(node.type)?String(node.checked):null),pressed:node.getAttribute('aria-pressed'),valueNow:node.getAttribute('aria-valuenow'),valueMin:node.getAttribute('aria-valuemin'),valueMax:node.getAttribute('aria-valuemax'),expanded:node.getAttribute('aria-expanded'),focused:document.activeElement===node,value:'value' in node?node.value:undefined})),
    rows:[...document.querySelectorAll('tr')].filter(visible).map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.textContent?.trim())),
    overflow:document.documentElement.scrollWidth-innerWidth,
  };
}

/** mount({fixture,theme,viewport,state,page}) returns {frame,ready?}; must navigate to
 * a real local reader. Source revisions are supplied independently, never inferred. */
export async function captureBrowserBaseline({browser,mount,implementation,sourceRevision,output,fixtures=browserParityFixtures,workerBrowsers=[browser]}) {
  if (!['jsx','html'].includes(implementation) || typeof sourceRevision!=='string' || !sourceRevision) throw Error('Explicit implementation and source identity required');
  await mkdir(output,{recursive:true});
  /** @type {import('../fixtures/component-baseline/contract').BrowserParityCapture[]} */
  const browserVersion=browser.version?.()||'unreported';
  const tasks=fixtures.flatMap(fixture=>parityThemes.flatMap(theme=>parityViewports.flatMap(viewport=>fixture.states.map(state=>({fixture,theme,viewport,state})))));
  const captures=new Array(tasks.length);
  async function capture({fixture,theme,viewport,state},workerBrowser) {
    const context=await workerBrowser.newContext({viewport,colorScheme:theme,reducedMotion:'reduce',locale:'en-US',timezoneId:'UTC'});
    try {
      const page=await context.newPage();
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      const {frame,ready,afterAction}=await mount({fixture,theme,viewport,state,page});
      const url=new URL(frame.url());
      if (!['127.0.0.1','localhost','app.lvh.me','lvh.me'].includes(url.hostname) && !url.hostname.endsWith('.lvh.me')) throw Error('Browser baseline must use an isolated local reader');
      await ready?.();
      await frame.evaluate(()=>document.fonts.ready);
      for(const action of state.actions) {
        const target=frame.getByRole(action.role,{...(action.name?{name:action.name,exact:true}:{})});
        if(action.action==='press') await target.press(action.key); else await target[action.action]();
        await afterAction?.(action);
      }
      await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const semantics=await frame.evaluate(browserState);
      const name=`${fixture.id}-${theme}-${viewport.width}-${state.id}-${implementation}.png`;
      // Capture the document viewport itself, excluding platform chrome.
      const screenshot=await page.screenshot({fullPage:false,animations:'disabled',caret:'hide'});
      await writeFile(path.join(output,name),screenshot);
      return {fixture:fixture.id,state:state.id,theme,viewport,screenshotMode:'viewport',browserVersion,implementation,sourceRevision,fixtureHash:hash(JSON.stringify(fixture)),screenshot:name,screenshotSha256:hash(screenshot),semantics,errors,assertionErrors:stateExpectationIssues(state.expected,semantics)};
    } finally {await context.close();}
  }
  let next=0,failed=false;
  const workers=await Promise.allSettled(Array.from({length:Math.min(2,workerBrowsers.length,tasks.length)},async(_,workerIndex)=>{
    while(!failed&&next<tasks.length){const index=next++;try{captures[index]=await capture(tasks[index],workerBrowsers[workerIndex]);}catch(error){failed=true;const task=tasks[index];throw new Error(`${task.fixture.id}/${task.theme}/${task.viewport.width}/${task.state.id}: ${error.message}`,{cause:error});}}
  }));
  const failure=workers.find(worker=>worker.status==='rejected');
  if(failure)throw failure.reason;
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
    results.push({key:key(old),sizeEqual,changedPixels,changedFraction:changedPixels===null?null:changedPixels/(left.info.width*left.info.height),rawBehaviorEqual:JSON.stringify(old.semantics)===JSON.stringify(current.semantics),behaviorEqual:JSON.stringify(comparableBehavior(old.semantics))===JSON.stringify(comparableBehavior(current.semantics)),baselineErrors:[...old.errors,...(old.assertionErrors||[])],candidateErrors:[...current.errors,...(current.assertionErrors||[])]});
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
    issues.push(...(capture.assertionErrors||[]));
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

/** Expectations describe the same observable outcomes for both real readers. */
export function stateExpectationIssues(expected,actual) {
  if(!expected)return [];
  const issues=[];
  const clean=text=>String(text).replace(/\s+/g,' ').trim();
  for(const text of expected.textIncludes||[])if(!clean(actual.text).includes(clean(text)))issues.push(`Missing visible text ${JSON.stringify(text)}`);
  for(const text of expected.hiddenText||[])if(clean(actual.text).includes(clean(text)))issues.push(`Unexpected visible text ${JSON.stringify(text)}`);
  for(const role of expected.roles||[]) {
    const matches=actual.controls.filter(control=>control.role===role.role&&control.name===role.name);
    if(!matches.length){issues.push(`Missing ${role.role} ${JSON.stringify(role.name)}`);continue;}
    if(!matches.some(control=>Object.entries(role).every(([key,value])=>key==='role'||key==='name'||(key==='disabled'?control[key]===value:String(control[key])===String(value)))))issues.push(`Unexpected state for ${role.role} ${JSON.stringify(role.name)}: expected ${JSON.stringify(role)}`);
  }
  if(expected.rows&&JSON.stringify(expected.rows)!==JSON.stringify(actual.rows))issues.push('Unexpected rendered table rows');
  for(const role of expected.rolesAbsent||[])if(actual.controls.some(control=>control.role===role.role&&control.name===role.name))issues.push(`Unexpected visible ${role.role} ${JSON.stringify(role.name)}`);
  return issues;
}
