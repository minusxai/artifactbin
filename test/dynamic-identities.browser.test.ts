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
   return {branchIdentity,reassigned,before,after,mountIdentity,removedIdentity,collision};
  });
  assert.equal(result.branchIdentity,'branch');assert.equal(result.reassigned,'alternate');assert.deepEqual(result.before,result.after);assert.notEqual(result.before[0],result.before[1]);assert.equal(result.mountIdentity,'mount');assert.equal(result.removedIdentity,null);assert.equal(result.collision.errors.length,1);assert.equal(result.collision.duplicate,null);assert.equal(result.collision.original,result.before[0]);
 }finally{await browser.close();}
});
