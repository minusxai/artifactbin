import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
test('dynamic branches, keyed reorder and later mounts keep exact identities; collisions refuse atomically',async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/migration/conversion/compiled/dynamic-identity-dom.ts',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'identityRuntime'});
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.setContent('<main id="root"></main>');await page.addScriptTag({content:'window.__name=(value)=>value;'+bundle.outputFiles[0]!.text});
  const result=await page.evaluate(async()=>{
   const runtime=(window as any).identityRuntime;
   const root=document.querySelector('main')!;
   const plan={regions:[{kind:'node',id:'root'},{kind:'conditional',test:{kind:'signal',name:'open'},yes:[{kind:'node',id:'branch'}],no:[{kind:'node',id:'alternate'}]},{kind:'repeat',owner:'rows',table:'items',keyBy:'key',children:[{kind:'node',id:'child'}]},{kind:'node',id:'mount'}]};
   const errors:string[]=[];const controller=runtime.installDynamicIdentities(document,plan,(e:Error)=>errors.push(e.message));controller.flush();
   const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
   const branch=document.createElement('div');branch.id='branch';root.append(branch);await tick();
   const branchIdentity=branch.getAttribute('data-af-id');branch.id='alternate';await tick();const reassigned=branch.getAttribute('data-af-id');branch.remove();
   const key=(value:string|number)=>'mx-instance-'+encodeURIComponent(JSON.stringify([['repeat','rows',typeof value,value],'child']));
   const rows=[1,'1'].map(value=>{const row=document.createElement('div');row.id=key(value);root.append(row);return row;});await tick();
   const before=rows.map(row=>row.getAttribute('data-af-id'));root.prepend(rows[1]!);await tick();const after=rows.map(row=>row.getAttribute('data-af-id'));
   const mount=document.createElement('section');mount.id='mount';root.append(mount);await tick();const mountIdentity=mount.getAttribute('data-af-id');mount.removeAttribute('id');await tick();const removedIdentity=mount.getAttribute('data-af-id');
   const duplicate=document.createElement('div');duplicate.id=rows[0]!.id;root.append(duplicate);await tick();
   const collision={errors,duplicate:duplicate.getAttribute('data-af-id'),original:rows[0]!.id};controller.dispose();
   root.replaceChildren();const invalid=document.createElement('div');invalid.id='mx-instance-'+encodeURIComponent(JSON.stringify([['repeat','rows','index',0],'child']));root.append(invalid);const other=runtime.installDynamicIdentities(document,plan,()=>{});let invalidRefused=false;try{other.flush();}catch{invalidRefused=true;}other.dispose();
   const invalidIdentity=invalid.getAttribute('data-af-id');root.replaceChildren();
   const cellPlan={regions:[{kind:'node',id:'root'},{kind:'cell',owner:'root',table:'items',rowKey:'id',column:'name',children:[{kind:'deferred',children:[{kind:'node',id:'cell-link'}]}]}]};
   const cellScope=(key:string|number,column='name')=>'mx-instance-'+encodeURIComponent(JSON.stringify([['table','root',typeof key,key,column],'cell-link']));
   const cells=[1,'1'].map(key=>{const element=document.createElement('a');element.id=cellScope(key);root.append(element);return element;});
   const cellController=runtime.installDynamicIdentities(document,cellPlan,()=>{});cellController.flush();const cellBefore=cells.map(element=>element.getAttribute('data-af-id'));root.prepend(cells[1]!);cellController.flush();const cellAfter=cells.map(element=>element.getAttribute('data-af-id'));
   const wrongColumn=document.createElement('a');wrongColumn.id=cellScope(2,'other');root.append(wrongColumn);let wrongColumnRefused=false;try{cellController.flush();}catch{wrongColumnRefused=true;}cellController.dispose();
   return {branchIdentity,reassigned,before,after,mountIdentity,removedIdentity,collision,invalidRefused,invalidIdentity,cellBefore,cellAfter,wrongColumnRefused,wrongColumnIdentity:wrongColumn.getAttribute('data-af-id')};
  });
  assert.equal(result.branchIdentity,'branch');assert.equal(result.reassigned,'alternate');assert.deepEqual(result.before,result.after);assert.notEqual(result.before[0],result.before[1]);assert.equal(result.mountIdentity,'mount');assert.equal(result.removedIdentity,null);assert.equal(result.collision.errors.length,1);assert.equal(result.collision.duplicate,null);assert.equal(result.collision.original,result.before[0]);assert.equal(result.invalidRefused,true);assert.equal(result.invalidIdentity,null);assert.deepEqual(result.cellBefore,result.cellAfter);assert.notEqual(result.cellBefore[0],result.cellBefore[1]);assert.equal(result.wrongColumnRefused,true);assert.equal(result.wrongColumnIdentity,null);
 }finally{await browser.close();}
});
test('audited deferred portal children normalize before user interaction, reopen stably and reject collisions',async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/migration/conversion/compiled/dynamic-identity-dom.ts',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'identityRuntime'});
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.setContent('<button id="trigger">Open</button>');await page.addScriptTag({content:'window.__name=(value)=>value;'+bundle.outputFiles[0]!.text});
  await page.evaluate(()=>{
   const runtime=(window as any).identityRuntime;const errors:string[]=[];(window as any).identityErrors=errors;
   const controller=runtime.installDynamicIdentities(document,{regions:[{kind:'node',id:'trigger'},{kind:'deferred',children:[{kind:'node',id:'portal-content'},{kind:'node',id:'portal-action'}]}]},(error:Error)=>errors.push(error.message));controller.flush();
   document.querySelector('button')!.addEventListener('click',()=>{const content=document.createElement('section');content.id='portal-content';const action=document.createElement('button');action.id='portal-action';action.textContent='Close';action.onclick=()=>{(window as any).clickedIdentity=action.getAttribute('data-af-id');content.remove();};content.append(action);document.body.append(content);});
  });
  for(let i=0;i<2;i++){await page.locator('#trigger').click();assert.equal(await page.locator('#portal-content').getAttribute('data-af-id'),'portal-content');await page.locator('#portal-action').click();assert.equal(await page.evaluate(()=>(window as any).clickedIdentity),'portal-action');assert.equal(await page.locator('#portal-content').count(),0);}
  await page.locator('#trigger').click();await page.evaluate(()=>{const duplicate=document.createElement('section');duplicate.id='portal-content';document.body.append(duplicate);});
  await page.waitForFunction(()=>(window as any).identityErrors.length===1);assert.equal(await page.locator('#portal-content').last().getAttribute('data-af-id'),null);
 }finally{await browser.close();}
});
