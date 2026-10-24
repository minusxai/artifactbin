/** Actual reader capture only: caller mounts a freshly published real reader URL.
 * No page.setContent, hand-rendered JSX, CSS surrogate or production writes. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { browserParityFixtures, parityThemes, parityViewports } from '../fixtures/component-baseline/index.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Failure logs contain bounded technical context, never URL credentials or queries. */
function diagnosticText(value){return String(value).replace(/https?:\/\/[^\s"'<>]+/g,value=>{try{const url=new URL(value);return url.origin+url.pathname;}catch{return '[URL]';}}).slice(0,1000);}
/** Linked stylesheet absence is a failure even before any font face is declared. */
function browserResources(){return {stylesheets:[...document.querySelectorAll('link[rel~="stylesheet"]')].filter(link=>!link.disabled).map(link=>({url:link.href,loaded:link.sheet!==null}))};}
/** Serializable behavior and geometry; generated IDs/classes intentionally excluded. */
function browserState() {
  const visible = node => !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const name = node => {
    const ids=node.getAttribute('aria-labelledby');
    if(ids){const label=clean(ids.split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' '));if(label)return label;}
    if(node.hasAttribute('aria-label'))return clean(node.getAttribute('aria-label'));
    if(node.tagName==='IMG')return clean(node.getAttribute('alt'));
    if(node.tagName==='TH'){const button=node.querySelector('button[aria-label]');if(button)return clean(button.getAttribute('aria-label'));}
    if(node.labels?.length)return clean([...node.labels].map(label=>label.textContent).join(' '));
    if(node.tagName==='INPUT'&&['button','submit','reset'].includes(node.type))return clean(node.value||(node.type==='submit'?'Submit':node.type==='reset'?'Reset':''));
    return clean(node.textContent||node.getAttribute('title'));
  };
  return {
    text: document.body.innerText.replace(/\s+/g,' ').trim(),
    controls: [...document.querySelectorAll('button,input,select,textarea,dialog,th[scope="col"],[role="tab"],[role="dialog"],[role="option"],[role="listbox"],[role="slider"],[role="switch"],[role="checkbox"],[role="radio"],[role="combobox"],[role="button"],[role="textbox"],[role="searchbox"],[role="spinbutton"],[role="progressbar"],[role="img"],[role="tooltip"],svg[aria-label],img[alt]')].filter(visible).map(node=>({role:node.getAttribute('role') || (node.tagName==='INPUT'?({file:'file-input',button:'button',submit:'button',reset:'button',checkbox:'checkbox',radio:'radio',range:'slider',number:'spinbutton',search:'searchbox'})[node.type]||'textbox':({BUTTON:'button',SELECT:'combobox',TEXTAREA:'textbox',DIALOG:'dialog',TH:'columnheader',IMG:'img',svg:'svg'})[node.tagName]),name:name(node),disabled:node.matches(':disabled') || node.getAttribute('aria-disabled')==='true',selected:node.getAttribute('aria-selected'),checked:node.getAttribute('aria-checked')??(node.tagName==='INPUT'&&['checkbox','radio'].includes(node.type)?String(node.checked):null),pressed:node.getAttribute('aria-pressed'),valueNow:node.getAttribute('aria-valuenow'),valueMin:node.getAttribute('aria-valuemin'),valueMax:node.getAttribute('aria-valuemax'),expanded:node.getAttribute('aria-expanded'),sort:node.getAttribute('aria-sort'),focused:document.activeElement===node,value:'value' in node?node.value:undefined})),
    rows:[...document.querySelectorAll('tr')].filter(visible).map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.textContent?.trim())),
    overflow:document.documentElement.scrollWidth-innerWidth,
  };
}

/** Browser-side proof for actually used declared fonts. Unused styles/subsets
 * remain legitimately unloaded; FontFaceSet.load resolves real matching ranges. */
export function fontLoadingEvidence() {
  return (async()=>{
    const clean=value=>String(value||'').trim().replace(/^['"]|['"]$/g,'');
    const ruleFaces=[];
    const rules=(list,base)=>{for(const rule of list||[]){
      if(rule.type===5){const style=rule.style;ruleFaces.push({family:clean(style.getPropertyValue('font-family')),style:style.getPropertyValue('font-style')||'normal',weight:style.getPropertyValue('font-weight')||'normal',unicodeRange:style.getPropertyValue('unicode-range')||'U+0-10FFFF',sources:[...style.getPropertyValue('src').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(match=>new URL(match[1],base).href)});}
      else if(rule.cssRules)rules(rule.cssRules,base);
    }};
    for(const sheet of document.styleSheets){try{rules(sheet.cssRules,sheet.href||document.baseURI);}catch{ /* A remote stylesheet cannot provide local font-byte proof. */ }}
    const requested=new Map();
    const add=(element,text)=>{
      if(!text.trim()||!element.getClientRects().length)return;
      const css=document.defaultView.getComputedStyle(element);if(css.visibility==='hidden')return;
      const family=clean(css.fontFamily.split(',')[0]);const key=[family,css.fontStyle,css.fontWeight].join('|');
      const existing=requested.get(key);if(existing)existing.text=(existing.text+' '+text).slice(0,512);else requested.set(key,{family,style:css.fontStyle||'normal',weight:css.fontWeight||'400',text:text.slice(0,512)});
    };
    const walk=document.createTreeWalker(document.body,document.defaultView.NodeFilter.SHOW_TEXT);
    for(let node=walk.nextNode();node;node=walk.nextNode())if(node.parentElement&&!['SCRIPT','STYLE','NOSCRIPT'].includes(node.parentElement.tagName))add(node.parentElement,node.textContent||'');
    for(const input of document.querySelectorAll('input,textarea'))if(input.value)add(input,input.value);
    const themeFamilies=['--font-body','--font-display','--font-mono'].map(key=>clean(document.defaultView.getComputedStyle(document.documentElement).getPropertyValue(key).split(',')[0])).filter(Boolean);
    const errors=[],used=[];
    for(const request of requested.values()){
      const declared=[...document.fonts].filter(face=>clean(face.family)===request.family);
      if(!declared.length){if(themeFamilies.includes(request.family))errors.push(`Used theme font ${request.family} has no declared font face`);used.push({...request,declared:false,sources:[]});continue;}
      try{
        const loaded=await document.fonts.load(`${request.style} ${request.weight} 16px ${JSON.stringify(request.family)}`,request.text);
        const sources=[...new Set(loaded.flatMap(face=>ruleFaces.filter(rule=>rule.family===clean(face.family)&&rule.style===face.style&&rule.unicodeRange.replace(/\s/g,'').toUpperCase()===(face.unicodeRange||'U+0-10FFFF').replace(/\s/g,'').toUpperCase()&&(rule.weight===face.weight||rule.weight==='normal'&&face.weight==='400')).flatMap(rule=>rule.sources)))];
        if(!loaded.length||loaded.some(face=>face.status!=='loaded'))errors.push(`Used declared font ${request.family} ${request.style} ${request.weight} did not load`);
        if(loaded.length&&!sources.length)errors.push(`Used declared font ${request.family} has no inspectable source URL`);
        used.push({...request,declared:true,loaded:loaded.length>0&&loaded.every(face=>face.status==='loaded'),sources});
      }catch(error){errors.push(`Used declared font ${request.family} ${request.style} ${request.weight} failed: ${error.message}`);used.push({...request,declared:true,loaded:false,sources:[]});}
    }
    await document.fonts.ready;
    return {faces:[...document.fonts].map(face=>({family:clean(face.family),style:face.style,weight:face.weight,unicodeRange:face.unicodeRange,status:face.status})),used,errors};
  })();
}

/** URL-independent proof: only resources used by matching authored faces count. */
export function fontByteProof(evidence) {
  if(!evidence)return {used:[],errors:['Missing font loading evidence']};
  const errors=[];
  const used=(evidence.used||[]).filter(face=>face.declared).map(face=>{
    const hashes=[...new Set((evidence.resources||[]).filter(resource=>face.sources.includes(resource.url)&&resource.status===200&&/^[a-f0-9]{64}$/.test(resource.sha256)).map(resource=>resource.sha256))].sort();
    if(!hashes.length)errors.push(`Used declared font ${face.family} ${face.style} ${face.weight} has no verified response bytes`);
    return {family:face.family,style:face.style,weight:face.weight,hashes};
  }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {used,errors};
}

/** mount({fixture,theme,viewport,state,page}) returns {frame,ready?}; must navigate to
 * a real local reader. Source revisions are supplied independently, never inferred. */
export async function captureBrowserBaseline({browser,mount,implementation,sourceRevision,output,fixtures=browserParityFixtures,workerBrowsers=[browser]}) {
  if (!['jsx','html'].includes(implementation) || typeof sourceRevision!=='string' || !sourceRevision) throw Error('Explicit implementation and source identity required');
  await mkdir(output,{recursive:true});
  /** @type {import('../fixtures/component-baseline/contract').BrowserParityCapture[]} */
  const browserVersion=browser.version?.()||'unreported';
  const tasks=fixtures.flatMap(fixture=>parityThemes.flatMap(theme=>parityViewports.flatMap(viewport=>fixture.states.map(state=>({fixture,theme,viewport,state})))));
  const captures=new Array(tasks.length),failures=[];
  // A failed new run must never archive a stale full verdict as current evidence.
  await Promise.all([`${implementation}-captures.json`,`${implementation}-partial-captures.json`].map(name=>rm(path.join(output,name),{force:true})));
  await writeFile(path.join(output,'capture-status.json'),JSON.stringify({complete:false,planned:tasks.length,completed:0,failures:[]}));
  async function capture({fixture,theme,viewport,state},workerBrowser) {
    const context=await workerBrowser.newContext({viewport,colorScheme:theme,reducedMotion:'reduce',locale:'en-US',timezoneId:'UTC'});
    const errors=[],fontResources=[],fontPending=[],resourceErrors=[],consoleErrors=[],requestFailures=[],httpFailures=[];let phase='mount',readerUrl='',page,frame,activeAction;
    try {
      page=await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(message.type()==='error'&&consoleErrors.length<20)consoleErrors.push(diagnosticText(message.text()));});
      page.on('requestfailed',request=>{if(requestFailures.length<20)requestFailures.push({type:request.resourceType(),url:diagnosticText(request.url()),error:diagnosticText(request.failure()?.errorText||'unknown')});});
      page.on('response',response=>{if(response.status()>=400&&httpFailures.length<20)httpFailures.push({type:response.request().resourceType(),url:diagnosticText(response.url()),status:response.status(),contentType:response.headers()['content-type']||''});});
      const local=value=>{const url=new URL(value);return ['data:','blob:'].includes(url.protocol)||['localhost','127.0.0.1','app.lvh.me','lvh.me'].includes(url.hostname)||url.hostname.endsWith('.lvh.me');};
      await page.route?.('**/*',route=>{const request=route.request();if(!local(request.url())){resourceErrors.push({url:request.url(),error:`External ${request.resourceType()} request blocked: ${request.url()}`});return route.abort('blockedbyclient');}return route.continue();});
      page.on('requestfailed',request=>{if(request.resourceType()==='font')resourceErrors.push({url:request.url(),error:`Font request failed: ${request.url()} (${request.failure()?.errorText||'unknown'})`});});
      page.on('response',response=>{if(response.request().resourceType()==='font')fontPending.push((async()=>{const status=response.status();try{const bytes=await response.body();fontResources.push({url:response.url(),status,sha256:hash(bytes)});if(status>=400)resourceErrors.push({url:response.url(),error:`Font HTTP ${status}: ${response.url()}`});}catch(error){resourceErrors.push({url:response.url(),error:`Font response unreadable: ${response.url()} (${error.message})`});}})());});
      const mounted=await mount({fixture,theme,viewport,state,page});frame=mounted.frame;const {ready,afterAction}=mounted;
      const url=new URL(frame.url());readerUrl=diagnosticText(url.href);
      if (!['127.0.0.1','localhost','app.lvh.me','lvh.me'].includes(url.hostname) && !url.hostname.endsWith('.lvh.me')) throw Error('Browser baseline must use an isolated local reader');
      phase='ready';await ready?.();phase='capture';
      await frame.evaluate(()=>document.fonts.ready);
      for(const action of state.actions) {
        activeAction=action;phase=`action:${action.action}`;
        const target=frame.getByRole(action.role,{...(action.name?{name:action.name,exact:true}:{})});
        if(action.action==='press') await target.press(action.key);
        else if(action.action==='scroll')await target.evaluate(table=>{const scroll=table.parentElement;if(!scroll||scroll.scrollHeight<=scroll.clientHeight)throw Error('Table has no scrollable parent');scroll.scrollTop=scroll.scrollHeight;});
        else await target[action.action]();
        await afterAction?.(action);
      }
      activeAction=undefined;phase='capture';
      await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const resourceEvidence=await frame.evaluate(browserResources);resourceEvidence.stylesheets??=[];resourceEvidence.errors=[];
      for(const sheet of resourceEvidence.stylesheets)if(!sheet.loaded)resourceEvidence.errors.push(`Stylesheet did not load: ${diagnosticText(sheet.url)}`);
      const localFailures=[...requestFailures,...httpFailures].filter(failure=>['stylesheet','script'].includes(failure.type)&&local(failure.url));
      for(const failure of localFailures)resourceEvidence.errors.push(`Local ${failure.type} failed: ${failure.url} (${failure.error||failure.status})`);
      const fontEvidence=await frame.evaluate(fontLoadingEvidence);
      await Promise.all(fontPending);
      fontEvidence.resources=fontResources;
      const usedSources=new Set(fontEvidence.used.flatMap(face=>face.sources||[]));
      fontEvidence.errors.push(...resourceErrors.filter(failure=>usedSources.has(failure.url)).map(failure=>failure.error));
      fontEvidence.errors.push(...fontByteProof(fontEvidence).errors);
      await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const semantics=await frame.evaluate(browserState);
      const name=`${fixture.id}-${theme}-${viewport.width}-${state.id}-${implementation}.png`;
      // Capture the document viewport itself, excluding platform chrome.
      const screenshot=await page.screenshot({fullPage:false,animations:'disabled',caret:'hide'});
      await writeFile(path.join(output,name),screenshot);
      return {fixture:fixture.id,state:state.id,theme,viewport,screenshotMode:'viewport',browserVersion,implementation,sourceRevision,fixtureHash:hash(JSON.stringify(fixture)),screenshot:name,screenshotSha256:hash(screenshot),semantics,fontEvidence,resourceEvidence,errors,assertionErrors:stateExpectationIssues(state.expected,semantics)};
    } catch(cause){
      const diagnostics={phase,url:readerUrl,pageErrors:errors.slice(0,20).map(diagnosticText),consoleErrors,requestFailures,httpFailures};
      /** @type {import('../fixtures/component-baseline/contract').BrowserCaptureFailure} */
      const failure={fixture:fixture.id,state:state.id,theme,viewport,implementation,sourceRevision,phase,...(activeAction?{action:activeAction}:{}),message:diagnosticText(cause.message),diagnostics};
      const stem=`${fixture.id}-${theme}-${viewport.width}-${state.id}-${implementation}-failure`;
      try{if(page?.screenshot){await writeFile(path.join(output,stem+'.png'),await page.screenshot({fullPage:false,animations:'disabled',caret:'hide',timeout:3000}));failure.screenshot=stem+'.png';}}catch(error){diagnostics.screenshotError=diagnosticText(error.message);}
      // Snapshot already mounted documents only; do not run readiness again.
      try{if(frame)failure.semantics=await frame.evaluate(browserState);}catch(error){diagnostics.snapshotError=diagnosticText(error.message);}
      failures.push(failure);
      try{await writeFile(path.join(output,stem+'.json'),JSON.stringify(failure,null,2));}catch(error){diagnostics.evidenceWriteError=diagnosticText(error.message);}
      throw new Error(`${diagnosticText(cause.message)}; reader diagnostics: ${JSON.stringify(diagnostics)}`,{cause});
    } finally {await context.close();}
  }
  let next=0,failed=false;
  const workers=await Promise.allSettled(Array.from({length:Math.min(2,workerBrowsers.length,tasks.length)},async(_,workerIndex)=>{
    while(!failed&&next<tasks.length){const index=next++;try{captures[index]=await capture(tasks[index],workerBrowsers[workerIndex]);}catch(error){failed=true;const task=tasks[index];throw new Error(`${task.fixture.id}/${task.theme}/${task.viewport.width}/${task.state.id}: ${error.message}`,{cause:error});}}
  }));
  const failure=workers.find(worker=>worker.status==='rejected');
  if(failure){
    try{await writeFile(path.join(output,`${implementation}-partial-captures.json`),JSON.stringify(captures.filter(Boolean),null,2));await writeFile(path.join(output,'capture-status.json'),JSON.stringify({complete:false,planned:tasks.length,completed:captures.filter(Boolean).length,failures},null,2));}
    catch(error){failure.reason.message+=`; partial evidence write failed: ${diagnosticText(error.message)}`;}
    throw failure.reason;
  }
  await writeFile(path.join(output,`${implementation}-captures.json`),JSON.stringify(captures,null,2));
  await writeFile(path.join(output,'capture-status.json'),JSON.stringify({complete:true,planned:tasks.length,completed:captures.length,failures:[]}));
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
    results.push({key:key(old),sizeEqual,changedPixels,changedFraction:changedPixels===null?null:changedPixels/(left.info.width*left.info.height),fontBytesEqual:JSON.stringify(fontByteProof(old.fontEvidence).used)===JSON.stringify(fontByteProof(current.fontEvidence).used),fontProofErrors:[...fontByteProof(old.fontEvidence).errors,...fontByteProof(current.fontEvidence).errors],rawBehaviorEqual:JSON.stringify(old.semantics)===JSON.stringify(current.semantics),behaviorEqual:JSON.stringify(comparableBehavior(old.semantics))===JSON.stringify(comparableBehavior(current.semantics)),baselineErrors:[...old.errors,...(old.assertionErrors||[]),...(old.fontEvidence?.errors||[])],candidateErrors:[...current.errors,...(current.assertionErrors||[]),...(current.fontEvidence?.errors||[]),...(current.resourceEvidence?.errors||[])]});
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
    issues.push(...(capture.assertionErrors||[]),...(capture.fontEvidence?.errors||[]),...(capture.resourceEvidence?.errors||[]));
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
  if(expected.bodyRows&&JSON.stringify(expected.bodyRows)!==JSON.stringify(actual.rows.slice(1)))issues.push('Unexpected rendered table body rows');
  for(const row of expected.bodyRowsInclude||[])if(!actual.rows.slice(1).some(actualRow=>JSON.stringify(actualRow)===JSON.stringify(row)))issues.push('Missing rendered table body row '+JSON.stringify(row));
  for(const role of expected.rolesAbsent||[])if(actual.controls.some(control=>control.role===role.role&&control.name===role.name))issues.push(`Unexpected visible ${role.role} ${JSON.stringify(role.name)}`);
  return issues;
}
