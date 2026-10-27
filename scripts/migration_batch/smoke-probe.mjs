/** Functional smoke probe for the existing imported-pilot camera hook (mountImportedPilot).
 * Self-contained: the loader copies this file alone into scratch, so it imports node builtins only.
 * The same probe runs on the original (jsx) and converted (html) reader. It selects authored ids,
 * which both implementations render, and never target-only DOM such as data-af-id.
 */
import{writeFile}from'node:fs/promises';import path from'node:path';

/** Runs inside the page (frame.evaluate): no closure references. */
export function observePage(contract){
 const norm=s=>String(s??'').replace(/\s+/g,' ').trim(),cap=s=>s.length>4000?s.slice(0,4000):s;
 const visible=n=>n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden';
 const busy=n=>n.getAttribute('aria-busy')==='true'||!!n.querySelector('[aria-busy="true"]');
 const data=(kind,n)=>{
  if(kind==='cell'){const label=n.querySelector('[aria-label="Live number"],[aria-label="Number placeholder"]')?.getAttribute('aria-label'),value=norm(n.textContent);return{loaded:label?label==='Live number':value!==''&&value!=='—',value}}
  if(kind==='chart'){const host=n.matches('[data-mx-chart-state],[data-native-chart-state]')?n:n.querySelector('[data-mx-chart-state],[data-native-chart-state]'),state=host?.getAttribute('data-mx-chart-state')??host?.getAttribute('data-native-chart-state')??null,surface=!!n.querySelector('svg,canvas');
   const labels=[...n.querySelectorAll('[role="graphics-symbol"]')].filter(m=>!/(axis|tick|legend|grid|title)/i.test(m.getAttribute('aria-roledescription')??'')).map(m=>norm(m.getAttribute('aria-label'))).filter(Boolean).sort().slice(0,500);
   return{loaded:state?state==='ready':surface,state,surface,marks:labels.length,labels}}
  if(kind==='table'){const rows=[...n.querySelectorAll('tbody tr,[role="row"]')].filter(r=>!r.querySelector('th,[role="columnheader"]'));return{loaded:rows.length>0,rows:rows.length,headers:[...n.querySelectorAll('th,[role="columnheader"]')].map(h=>norm(h.textContent)).filter(Boolean)}}
  if(kind==='diagram')return{loaded:!!n.querySelector('svg')};
  return undefined;
 };
 const entries={};
 for(const e of contract.entries){
  const nodes=[...document.querySelectorAll(`[id="${CSS.escape(e.id)}"]`)].slice(0,50);
  entries[e.id]={count:document.querySelectorAll(`[id="${CSS.escape(e.id)}"]`).length,instances:nodes.map(n=>{const text=norm(n.textContent);return{visible:visible(n),busy:busy(n),text:cap(text),textLength:text.length,...(data(e.kind,n)?{data:data(e.kind,n)}:{})}})};
 }
 return{side:document.querySelector('[data-af-id]')?'target':'source',title:norm(document.title),entries};
}

/** Ids of data components that are present but not yet showing loaded, idle data. */
export function pendingIds(contract,observation){
 return contract.entries.filter(e=>['cell','chart','table','diagram'].includes(e.kind)).filter(e=>observation.entries[e.id]?.instances.some(i=>i.busy||!i.data?.loaded)).map(e=>e.id);
}

/** Fonts plus data deadlines stay under the camera's own 30s reader-ready limit, so an unsettled page is still recorded.
 * @param {import('./smoke-contracts.mjs').SmokeContract} contract */
export function createSmokeProbe(contract,{deadlineMs=20000,intervalMs=250}={}){return async function mountImportedPilot({frame,reader,state,viewport,regression,output}){
 if(reader?.version!==contract.key.version||state.actions.length)throw Error('smoke_probe_scope');let written=false;
 return{
  async ready(){
   await frame.evaluate(()=>Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,5000))]));
   const deadline=Date.now()+deadlineMs;let previous,observation,pending;
   // Settled: every present data component loaded and idle, and two consecutive observations agree.
   for(;;){observation=await frame.evaluate(observePage,contract);pending=pendingIds(contract,observation);const same=previous!==undefined&&JSON.stringify(observation)===previous;if((!pending.length&&same)||Date.now()>deadline)break;previous=JSON.stringify(observation);await new Promise(r=>setTimeout(r,intervalMs));}
   // An unsettled page is recorded rather than thrown, so screenshots still run and compare classifies it.
   const name=`smoke-${observation.side}-${state.id}-${viewport.width}x${viewport.height}-${regression?'regression':'normal'}.json`;
   await writeFile(path.join(output,name),JSON.stringify({format:'migration-smoke-observation-v1',key:contract.key,contractSha256:contract.sha256,readerPageId:reader.pageId,state:state.id,viewport,regression,settled:!pending.length,pending,...observation},null,2)+'\n',{flag:'wx',mode:0o600});written=true;
  },
  async performAction(){throw Error('smoke_actions_not_supported')},async afterAction(){throw Error('smoke_actions_not_supported')},
  async cleanup(){if(!written)throw Error('smoke_probe_incomplete')},
 };
}}
