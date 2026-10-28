import {mkdtemp,mkdir,writeFile,readFile,rm,cp} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';
import {afterEach,expect,it} from 'vitest';
import {buildComponentAssets} from '../lib/html-components-build.mjs';
import {writeComponentAssetReceipt,verifyComponentAssetArchive,builtComponentFiles,COMPONENT_RECEIPT} from '../lib/component-asset-proof.mjs';
import {BUILD_OUTPUTS} from '../lib/gate-container.mjs';
import {attachVerifiedComponentAssets,writeBaselineComponentAssets} from '../lib/component-baseline-input.mjs';
const roots=[];afterEach(async()=>Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true}))));
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'component-proof-'));roots.push(root);return root;}
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
 expect(await builtComponentFiles({root:checkout})).toEqual(files);
 expect(await readFile(path.join(checkout,COMPONENT_RECEIPT),'utf8')).toContain('component-assets-v1');
});
it('rejects a stale served module, source-stale build and omitted transitive output',async()=>{
 const root=await fixture(),files=await built(root);
 await expect(verifyComponentAssetArchive({root,files:new Map([['components/slide.js',Buffer.from('export const gutter=0;')]])})).rejects.toThrow('Served component bytes differ');
 await expect(verifyComponentAssetArchive({root,files:new Map()})).rejects.toThrow('module closure differs');
 await writeFile(path.join(root,'source/slide.ts'),'export const gutter=48;');
 await expect(verifyComponentAssetArchive({root,files})).rejects.toThrow('Stale component build');
});
it('adds verified hosted-module proof to supplied reader entries without republishing the private selection',async()=>{
 const root=await fixture(),files=await built(root);
 const entries=[{fixture:'chosen-private-fixture',theme:'dark',url:'http://localhost:3030/a/Private123/raw'}],input={implementation:'html',sourceRevision:'source-bound-candidate',entries,output:path.join(root,'evidence')};
 const requested=[];
 const result=await attachVerifiedComponentAssets(input,{source:root,base:'http://localhost:3030',fetcher:server(files,requested)});
 expect(requested).toEqual(['http://localhost:3030/af/components/slide.js']);expect(result.entries).toBe(entries);expect(result.componentAssets.modules).toEqual([{path:'components/slide.js',sha256:expect.any(String)}]);expect(result.componentAssets.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
 await expect(attachVerifiedComponentAssets(input,{source:root,base:'http://localhost:3030',fetcher:server(new Map([['components/slide.js',Buffer.from('export const gutter=0;')]]))})).rejects.toThrow('Served component bytes differ');
 await expect(attachVerifiedComponentAssets(input,{source:root,base:'http://localhost:3030',fetcher:server(new Map())})).rejects.toThrow('Hosted component unavailable (404): components/slide.js');
 await writeFile(path.join(root,'source/slide.ts'),'export const gutter=48;');
 await expect(attachVerifiedComponentAssets({...input,entries},{source:root,base:'http://localhost:3030',fetcher:server(files)})).rejects.toThrow('Stale component build');
});

it('writes the exact component asset proof into a fresh nested capture output before capture',async()=>{
 const root=await fixture(),output=path.join(root,'fresh','html-evidence');
 const componentAssets={receiptSha256:'a'.repeat(64),modules:[{path:'components/slide.js',sha256:'b'.repeat(64)}]};
 const input={implementation:'html',sourceRevision:'candidate-source',componentAssets,output};
 await writeBaselineComponentAssets(input);
 expect(JSON.parse(await readFile(path.join(output,'component-assets.json'),'utf8'))).toEqual({implementation:'html',sourceRevision:'candidate-source',componentAssets});
 const updated={...componentAssets,receiptSha256:'c'.repeat(64)};
 await writeBaselineComponentAssets({...input,componentAssets:updated});
 expect(JSON.parse(await readFile(path.join(output,'component-assets.json'),'utf8')).componentAssets).toEqual(updated);
});
