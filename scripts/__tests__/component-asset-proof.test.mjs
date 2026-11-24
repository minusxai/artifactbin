/** Build-cache and HTTP receipt checks used by the native reader gate. */
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import path from 'node:path';
import {expect,it,onTestFinished} from 'vitest';
import {buildComponentAssets} from '../lib/html-components-build.mjs';
import {writeComponentAssetReceipt,verifyComponentAssetArchive,hostedComponentFiles,COMPONENT_RECEIPT} from '../lib/component-asset-proof.mjs';
import {BUILD_OUTPUTS} from '../lib/gate-container.mjs';
import {tempDir} from '../../services/test-support/src/temp-dir.ts';
async function fixture(){const root=await tempDir('component-proof-',onTestFinished);return root;}
// Same layout as the real build: compiled hosted modules under lib/build-assets, readable sources in the skill.
const OUTPUT='services/app/lib/build-assets/components',READABLE='services/app/skills/artifactbin/components';
async function built(root){
 const sourceDir=path.join(root,'source'),outputDir=path.join(root,OUTPUT);await mkdir(sourceDir,{recursive:true});await writeFile(path.join(sourceDir,'slide.ts'),'export const gutter=24;');await buildComponentAssets({sourceDir,outputDir,readableDir:path.join(root,READABLE)});
 await writeComponentAssetReceipt({root,inputs:['source/slide.ts'],outputs:[OUTPUT+'/slide.js',READABLE+'/slide.ts']});
 return new Map([['components/slide.js',await readFile(path.join(outputDir,'slide.js'))]]);
}
/** The candidate server: `/af/components/<file>` serves `files`' bytes, anything else 404s. */
const server=(files,requested=[])=>async url=>{requested.push(String(url));const {pathname}=new URL(url),bytes=pathname.startsWith('/af/')&&files.get(pathname.slice('/af/'.length));return bytes?new Response(bytes,{status:200}):new Response('missing',{status:404});};
it('restores generated modules over stale prior modules on the same cache contract gates use',async()=>{
 const cache=await fixture(),checkout=await fixture();const files=await built(cache);await mkdir(path.join(checkout,'source'));await cp(path.join(cache,'source/slide.ts'),path.join(checkout,'source/slide.ts'));
 // The readable source copy is a tracked checkout file, not a cached build output.
 await cp(path.join(cache,READABLE),path.join(checkout,READABLE),{recursive:true});
 const stale=path.join(checkout,OUTPUT,'slide.js');await mkdir(path.dirname(stale),{recursive:true});await writeFile(stale,'export const gutter=0;');
 for(const entry of BUILD_OUTPUTS){try{await cp(path.join(cache,entry),path.join(checkout,entry),{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}}
 expect(await readFile(stale)).toEqual(files.get('components/slide.js'));
 expect((await verifyComponentAssetArchive({root:checkout,files})).modules).toHaveLength(1);
 expect(await readFile(path.join(checkout,COMPONENT_RECEIPT),'utf8')).toContain('component-assets-v1');
});
it('rejects a stale served module, source-stale build and omitted transitive output',async()=>{
 const root=await fixture(),files=await built(root);
 await expect(verifyComponentAssetArchive({root,files:new Map([['components/slide.js',Buffer.from('export const gutter=0;')]])})).rejects.toThrow('Served component bytes differ');
 await expect(verifyComponentAssetArchive({root,files:new Map()})).rejects.toThrow('module closure differs');
 await writeFile(path.join(root,'source/slide.ts'),'export const gutter=48;');
 await expect(verifyComponentAssetArchive({root,files})).rejects.toThrow('Stale component build');
});
it('reads the receipt-listed hosted modules over HTTP for verification',async()=>{
 const root=await fixture(),files=await built(root),requested=[];
 const origin='http://localhost:3030';
 const hosted=await hostedComponentFiles({root,origin,fetcher:server(files,requested)});
 expect(requested).toEqual([origin+'/af/components/slide.js']);
 expect((await verifyComponentAssetArchive({root,files:hosted})).modules).toEqual([
  {path:'components/slide.js',sha256:expect.stringMatching(/^[a-f0-9]{64}$/)},
 ]);
 await expect(hostedComponentFiles({root,origin,fetcher:server(new Map())})).rejects.toThrow('Hosted component unavailable (404)');
});
