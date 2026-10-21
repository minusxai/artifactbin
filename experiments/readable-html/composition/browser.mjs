import {build} from 'esbuild';
import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
const code=(await build({entryPoints:['experiments/readable-html/composition/client.ts'],bundle:true,write:false,format:'iife',platform:'browser',minify:true})).outputFiles[0].text;
for(const engine of [chromium,firefox,webkit]){
 const browser=await engine.launch();try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('about:blank');await page.addScriptTag({content:code});
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.phaseClientProof),{observed:[0,5,0],rejected:true,queued:0,confirmed:0,history:0,disposed:true});console.log(engine.name()+': real browser GraphQL/replica lifecycle passed');
 }finally{await browser.close();}
}
